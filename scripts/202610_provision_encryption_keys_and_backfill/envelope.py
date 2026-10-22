"""
Envelope for listed columns. Byte layout shared with SkyDIIV web v2.0.0:

- Wrapped DEK and field ciphertext are standard base64 of
  12-byte nonce || ciphertext || 16-byte GCM tag.
- Field additional authenticated data is UTF-8 of
  table + NUL + column + NUL + row id. DEK wrap has no AAD.
- Lookup hash is standard base64 of HMAC-SHA256(lookup key,
  UTF-8 of table + NUL + column + NUL + normalized plaintext).
- Email is trimmed and lowercased before hashing and before it is sealed.
- Birth date is stored as YYYY-MM-DD (ISO timestamps are sliced at T).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
from dataclasses import dataclass, field

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

NONCE_BYTES = 12
TAG_BYTES = 16
KEY_BYTES = 32

# Local worker/web test vectors — never insert these into D1.
LOCAL_TEST_KEK = bytes(32 * [0x11])
LOCAL_TEST_LOOKUP_KEY = bytes(32 * [0x22])

_BIRTH_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_BIRTH_DATE_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T")


class FieldEncryptionError(Exception):
    pass


@dataclass(frozen=True)
class EncryptedModelSpec:
    table: str
    fields: tuple[str, ...]
    lookup: tuple[str, ...] = ()
    hash_column: str | None = None


ACTOR_COLUMNS: tuple[str, str] = ("created_by", "updated_by")
EXCLUDED_ACTOR_TABLES: tuple[str, ...] = (
    "access_keys",
    "domains",
    "events",
    "outbox_events",
)


def _with_actors(*fields: str) -> tuple[str, ...]:
    return fields + ACTOR_COLUMNS


# SkyDIIV web v2.0.0 ENCRYPTED_MODELS plus actor columns, keyed by table name.
ENCRYPTED_MODELS: dict[str, EncryptedModelSpec] = {
    "clothing_items": EncryptedModelSpec(
        table="clothing_items",
        fields=_with_actors("image_url"),
    ),
    "feedbacks_automatic_thrifting": EncryptedModelSpec(
        table="feedbacks_automatic_thrifting",
        fields=_with_actors("reason"),
    ),
    "summaries_feedbacks_automatic_thrifting": EncryptedModelSpec(
        table="summaries_feedbacks_automatic_thrifting",
        fields=_with_actors("summary"),
    ),
    "llm_interactions": EncryptedModelSpec(
        table="llm_interactions",
        fields=_with_actors("prompt", "client_prompt", "response"),
    ),
    "outfits": EncryptedModelSpec(
        table="outfits",
        fields=_with_actors("image_url"),
    ),
    "shopping_suggestions_preferences": EncryptedModelSpec(
        table="shopping_suggestions_preferences",
        fields=_with_actors("top_size", "bottom_size", "foot_size", "gender"),
    ),
    "tags": EncryptedModelSpec(
        table="tags",
        fields=ACTOR_COLUMNS,
    ),
    "users": EncryptedModelSpec(
        table="users",
        fields=_with_actors(
            "first_name",
            "last_name",
            "preferred_name",
            "email",
            "birth_date",
            "profile_picture_url",
        ),
        lookup=("email",),
        hash_column="email_lookup",
    ),
    "wardrobe_panorama": EncryptedModelSpec(
        table="wardrobe_panorama",
        fields=_with_actors("content"),
    ),
    "weekly_outfit_preferences": EncryptedModelSpec(
        table="weekly_outfit_preferences",
        fields=_with_actors("location", "routine_description"),
    ),
}

BACKFILL_TABLES: tuple[str, ...] = (
    "users",
    "weekly_outfit_preferences",
    "shopping_suggestions_preferences",
    "clothing_items",
    "feedbacks_automatic_thrifting",
    "summaries_feedbacks_automatic_thrifting",
    "llm_interactions",
    "outfits",
    "wardrobe_panorama",
    "tags",
)


@dataclass
class SealedModelValues:
    values: dict[str, str | None]
    dek: str
    kek_version: int
    lookup_key_version: int
    encrypted_columns: list[str]
    lookup_columns: list[str] = field(default_factory=list)
    hashes: dict[str, str] = field(default_factory=dict)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def email_lookup_for(email: str, lookup_key: bytes) -> str:
    return lookup_hash(
        lookup_key=lookup_key,
        table="users",
        column="email",
        plaintext=normalize_email(email),
    )


def rewrite_actor(value: str | None, lookup_key: bytes) -> str | None:
    if value is None:
        return None
    if "@" not in value:
        return value
    return email_lookup_for(value, lookup_key)


def rewrite_actor_values(
    values: dict[str, str | None], lookup_key: bytes
) -> dict[str, str | None]:
    rewritten = dict(values)
    for column in ACTOR_COLUMNS:
        if column in rewritten:
            rewritten[column] = rewrite_actor(rewritten[column], lookup_key)
    return rewritten


def encode_key(material: bytes) -> str:
    return base64.b64encode(material).decode("ascii")


def decode_aes_key(encoded: str) -> bytes:
    trimmed = encoded.strip()
    try:
        key = base64.b64decode(trimmed, validate=True)
    except Exception as exc:
        raise FieldEncryptionError("Encryption keys are unavailable") from exc
    if len(key) != KEY_BYTES or encode_key(key) != trimmed:
        raise FieldEncryptionError("Encryption keys are unavailable")
    return key


def generate_key_bytes() -> bytes:
    material = secrets.token_bytes(KEY_BYTES)
    if material in (LOCAL_TEST_KEK, LOCAL_TEST_LOOKUP_KEY):
        raise FieldEncryptionError("Generated key material matched a local test vector")
    return material


def lookup_hash(*, lookup_key: bytes, table: str, column: str, plaintext: str) -> str:
    message = f"{table}\0{column}\0{plaintext}".encode("utf-8")
    digest = hmac.new(lookup_key, message, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def authenticated_data(*, table: str, column: str, row_id: str) -> bytes:
    return f"{table}\0{column}\0{row_id}".encode("utf-8")


def seal_model_values(
    *,
    table: str,
    row_id: str,
    values: dict[str, str | None],
    kek: bytes,
    kek_version: int,
    lookup_key: bytes,
    lookup_key_version: int,
) -> SealedModelValues | None:
    spec = ENCRYPTED_MODELS.get(table)
    if spec is None:
        raise FieldEncryptionError("Encryption keys are unavailable")

    listed = {column: values[column] for column in spec.fields if column in values}
    if not any(value is not None for value in listed.values()):
        return None

    dek = os.urandom(KEY_BYTES)
    sealed: dict[str, str | None] = {}
    encrypted_columns: list[str] = []
    lookup_columns: list[str] = []
    hashes: dict[str, str] = {}

    for column in spec.fields:
        if column not in values:
            continue
        raw = values[column]
        if raw is None:
            sealed[column] = None
            continue
        stored = _canonical_plaintext(spec.table, column, raw)
        sealed[column] = encrypt_field(
            dek=dek,
            table=spec.table,
            column=column,
            row_id=row_id,
            plaintext=stored,
        )
        encrypted_columns.append(column)

    for column in spec.lookup:
        if sealed.get(column) is None:
            continue
        plaintext = _canonical_plaintext(spec.table, column, values.get(column) or "")
        hash_name = spec.hash_column or f"{column}_lookup"
        hashes[hash_name] = lookup_hash(
            lookup_key=lookup_key,
            table=spec.table,
            column=column,
            plaintext=plaintext,
        )
        lookup_columns.append(column)

    return SealedModelValues(
        values=sealed,
        dek=wrap_dek(dek, kek),
        kek_version=kek_version,
        lookup_key_version=lookup_key_version,
        encrypted_columns=encrypted_columns,
        lookup_columns=lookup_columns,
        hashes=hashes,
    )


def open_model_values(
    *,
    table: str,
    row_id: str,
    values: dict[str, str | None],
    dek: str,
    kek: bytes,
    encrypted_columns: list[str],
) -> dict[str, str | None]:
    spec = ENCRYPTED_MODELS.get(table)
    if spec is None:
        raise FieldEncryptionError("Encryption keys are unavailable")
    unwrapped = unwrap_dek(dek, kek)
    opened = dict(values)
    for column in encrypted_columns:
        if column not in spec.fields:
            raise FieldEncryptionError("Failed to decrypt field")
        ciphertext = values.get(column)
        if ciphertext is None:
            opened[column] = None
            continue
        if not isinstance(ciphertext, str):
            raise FieldEncryptionError("Failed to decrypt field")
        opened[column] = decrypt_field(
            dek=unwrapped,
            table=spec.table,
            column=column,
            row_id=row_id,
            payload=ciphertext,
        )
    return opened


def encrypt_field(
    *,
    dek: bytes,
    table: str,
    column: str,
    row_id: str,
    plaintext: str,
) -> str:
    return _encrypt_aes_gcm(
        dek,
        plaintext.encode("utf-8"),
        authenticated_data(table=table, column=column, row_id=row_id),
    )


def decrypt_field(
    *,
    dek: bytes,
    table: str,
    column: str,
    row_id: str,
    payload: str,
) -> str:
    return _decrypt_aes_gcm(
        dek,
        payload,
        authenticated_data(table=table, column=column, row_id=row_id),
    ).decode("utf-8")


def wrap_dek(dek: bytes, kek: bytes) -> str:
    return _encrypt_aes_gcm(kek, dek, None)


def unwrap_dek(wrapped: str, kek: bytes) -> bytes:
    dek = _decrypt_aes_gcm(kek, wrapped, None)
    if len(dek) != KEY_BYTES:
        raise FieldEncryptionError("Failed to decrypt field")
    return dek


def packed_parts(payload: str) -> tuple[bytes, bytes, bytes]:
    packed = base64.b64decode(payload)
    if len(packed) < NONCE_BYTES + TAG_BYTES:
        raise FieldEncryptionError("Failed to decrypt field")
    nonce = packed[:NONCE_BYTES]
    tag = packed[-TAG_BYTES:]
    ciphertext = packed[NONCE_BYTES:-TAG_BYTES]
    return nonce, ciphertext, tag


def _canonical_plaintext(table: str, column: str, value: str) -> str:
    if table == "users" and column == "email":
        return normalize_email(value)
    if table == "users" and column == "birth_date":
        return _canonical_birth_date(value)
    return value


def _canonical_birth_date(value: str) -> str:
    trimmed = value.strip()
    if _BIRTH_DATE.fullmatch(trimmed):
        return trimmed
    if _BIRTH_DATE_ISO.match(trimmed):
        return trimmed[:10]
    raise FieldEncryptionError("Failed to encrypt field")


def _encrypt_aes_gcm(key: bytes, plaintext: bytes, aad: bytes | None) -> str:
    nonce = os.urandom(NONCE_BYTES)
    packed = nonce + AESGCM(key).encrypt(nonce, plaintext, aad)
    return base64.b64encode(packed).decode("ascii")


def _decrypt_aes_gcm(key: bytes, payload: str, aad: bytes | None) -> bytes:
    nonce, ciphertext, tag = packed_parts(payload)
    try:
        return AESGCM(key).decrypt(nonce, ciphertext + tag, aad)
    except (InvalidTag, ValueError) as exc:
        raise FieldEncryptionError("Failed to decrypt field") from exc
