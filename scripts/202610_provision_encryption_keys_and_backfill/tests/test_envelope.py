"""Envelope unit tests — no live D1 or Neon."""

from __future__ import annotations

import base64

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from envelope import (
    ENCRYPTED_MODELS,
    EXCLUDED_ACTOR_TABLES,
    LOCAL_TEST_KEK,
    LOCAL_TEST_LOOKUP_KEY,
    FieldEncryptionError,
    email_lookup_for,
    lookup_hash,
    normalize_email,
    open_model_values,
    packed_parts,
    rewrite_actor,
    seal_model_values,
    unwrap_dek,
)

KEK = bytes(32 * [7])
LOOKUP_KEY = bytes(32 * [9])


def _seal_user(values: dict[str, str | None], row_id: str = "user-1"):
    return seal_model_values(
        table="users",
        row_id=row_id,
        values=values,
        kek=KEK,
        kek_version=1,
        lookup_key=LOOKUP_KEY,
        lookup_key_version=1,
    )


def test_titles_and_tag_names_are_not_in_the_model_map() -> None:
    assert "title" not in ENCRYPTED_MODELS["clothing_items"].fields
    assert "title" not in ENCRYPTED_MODELS["outfits"].fields
    assert "name" not in ENCRYPTED_MODELS["tags"].fields
    assert ENCRYPTED_MODELS["clothing_items"].fields == (
        "image_url",
        "created_by",
        "updated_by",
    )
    assert ENCRYPTED_MODELS["outfits"].fields == ("image_url", "created_by", "updated_by")
    assert ENCRYPTED_MODELS["tags"].fields == ("created_by", "updated_by")
    for excluded in EXCLUDED_ACTOR_TABLES:
        assert excluded not in ENCRYPTED_MODELS


def test_round_trip_plaintext_and_omit_nulls() -> None:
    sealed_image = seal_model_values(
        table="clothing_items",
        row_id="piece-1",
        values={"image_url": "https://img", "title": "Linen shirt"},
        kek=KEK,
        kek_version=1,
        lookup_key=LOOKUP_KEY,
        lookup_key_version=1,
    )
    assert sealed_image is not None
    assert "title" not in sealed_image.values
    assert sealed_image.values["image_url"] != "https://img"
    assert sealed_image.encrypted_columns == ["image_url"]
    opened_image = open_model_values(
        table="clothing_items",
        row_id="piece-1",
        values=sealed_image.values,
        dek=sealed_image.dek,
        kek=KEK,
        encrypted_columns=sealed_image.encrypted_columns,
    )
    assert opened_image["image_url"] == "https://img"

    sealed = _seal_user(
        {
            "first_name": "Ada",
            "last_name": "Lovelace",
            "preferred_name": None,
            "email": "ada@example.com",
            "birth_date": "1990-01-02",
            "profile_picture_url": None,
        }
    )
    assert sealed is not None
    assert sealed.values["preferred_name"] is None
    assert sealed.values["profile_picture_url"] is None
    assert "preferred_name" not in sealed.encrypted_columns
    assert "profile_picture_url" not in sealed.encrypted_columns
    assert "first_name" in sealed.encrypted_columns
    assert sealed.values["first_name"] != "Ada"
    opened = open_model_values(
        table="users",
        row_id="user-1",
        values=sealed.values,
        dek=sealed.dek,
        kek=KEK,
        encrypted_columns=sealed.encrypted_columns,
    )
    assert opened["first_name"] == "Ada"
    assert opened["preferred_name"] is None
    assert opened["email"] == "ada@example.com"
    assert opened["birth_date"] == "1990-01-02"


def test_packed_layout_nonce_ciphertext_tag_and_aad() -> None:
    sealed = seal_model_values(
        table="clothing_items",
        row_id="piece-1",
        values={"image_url": "https://img"},
        kek=KEK,
        kek_version=1,
        lookup_key=LOOKUP_KEY,
        lookup_key_version=1,
    )
    assert sealed is not None
    payload = sealed.values["image_url"]
    assert payload is not None

    nonce, ciphertext, tag = packed_parts(payload)
    assert len(nonce) == 12
    assert len(tag) == 16
    packed = base64.b64decode(payload)
    assert packed == nonce + ciphertext + tag

    dek = unwrap_dek(sealed.dek, KEK)
    assert len(dek) == 32
    aad = b"clothing_items\0image_url\0piece-1"
    assert AESGCM(dek).decrypt(nonce, ciphertext + tag, aad) == b"https://img"
    with pytest.raises(Exception):
        AESGCM(dek).decrypt(
            nonce, ciphertext + tag, b"clothing_items\0image_url\0other"
        )
    wrap_nonce, wrap_ciphertext, wrap_tag = packed_parts(sealed.dek)
    with pytest.raises(Exception):
        AESGCM(KEK).decrypt(wrap_nonce, wrap_ciphertext + wrap_tag, b"aad")
    assert AESGCM(KEK).decrypt(wrap_nonce, wrap_ciphertext + wrap_tag, None) == dek

    with pytest.raises(FieldEncryptionError):
        open_model_values(
            table="clothing_items",
            row_id="other-piece",
            values={"image_url": payload},
            dek=sealed.dek,
            kek=KEK,
            encrypted_columns=["image_url"],
        )


def test_deterministic_lookup_hash_for_mixed_case_email() -> None:
    expected = lookup_hash(
        lookup_key=LOOKUP_KEY,
        table="users",
        column="email",
        plaintext="ada@example.com",
    )
    first = _seal_user({"email": "Ada@Example.com"})
    second = _seal_user({"email": " ada@example.com "})
    assert first is not None and second is not None
    assert first.hashes["email_lookup"] == expected
    assert second.hashes["email_lookup"] == expected
    assert first.values["email"] != second.values["email"]
    assert first.values["email"] != "ada@example.com"
    assert first.lookup_columns == ["email"]
    assert first.lookup_key_version == 1
    assert normalize_email("Ada@Example.com") == "ada@example.com"
    assert expected != "ada@example.com"


def test_empty_string_summary_is_listed() -> None:
    sealed = seal_model_values(
        table="summaries_feedbacks_automatic_thrifting",
        row_id="sum-1",
        values={"summary": ""},
        kek=KEK,
        kek_version=1,
        lookup_key=LOOKUP_KEY,
        lookup_key_version=1,
    )
    assert sealed is not None
    assert sealed.encrypted_columns == ["summary"]
    assert sealed.values["summary"] != ""
    opened = open_model_values(
        table="summaries_feedbacks_automatic_thrifting",
        row_id="sum-1",
        values=sealed.values,
        dek=sealed.dek,
        kek=KEK,
        encrypted_columns=sealed.encrypted_columns,
    )
    assert opened["summary"] == ""


def test_all_null_listed_values_leave_no_envelope() -> None:
    sealed = _seal_user(
        {
            "first_name": None,
            "last_name": None,
            "preferred_name": None,
            "email": None,
            "birth_date": None,
            "profile_picture_url": None,
        }
    )
    assert sealed is None


def test_birth_date_iso_timestamp_is_sliced() -> None:
    sealed = _seal_user({"birth_date": "1990-01-02T15:04:05.000Z"})
    assert sealed is not None
    opened = open_model_values(
        table="users",
        row_id="user-1",
        values=sealed.values,
        dek=sealed.dek,
        kek=KEK,
        encrypted_columns=sealed.encrypted_columns,
    )
    assert opened["birth_date"] == "1990-01-02"


def test_actor_rewrite_hashes_email_in_place() -> None:
    expected = email_lookup_for("Ada@Example.com", LOOKUP_KEY)
    assert rewrite_actor("Ada@Example.com", LOOKUP_KEY) == expected
    assert rewrite_actor(" ada@example.com ", LOOKUP_KEY) == expected
    assert expected != "ada@example.com"
    assert rewrite_actor("worker-ai-workflows", LOOKUP_KEY) == "worker-ai-workflows"
    assert rewrite_actor(None, LOOKUP_KEY) is None


def test_local_test_vectors_are_the_documented_bytes() -> None:
    assert LOCAL_TEST_KEK == bytes(32 * [0x11])
    assert LOCAL_TEST_LOOKUP_KEY == bytes(32 * [0x22])
    assert base64.b64encode(LOCAL_TEST_KEK).decode("ascii") == (
        "ERERERERERERERERERERERERERERERERERERERERERE="
    )
