"""Cloudflare D1 HTTP API (same path workers use for key queries)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx

from envelope import decode_aes_key

API_BASE = "https://api.cloudflare.com/client/v4"
DEFAULT_DATABASE_NAME = "skydiiv--production"
CREATED_BY = "script:202610_provision_encryption_keys_and_backfill"

CREATE_ENCRYPTION_KEYS_SQL = """
CREATE TABLE IF NOT EXISTS encryption_keys (
  kek TEXT NOT NULL,
  kek_version INTEGER NOT NULL,
  lookup_key TEXT NOT NULL,
  lookup_key_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (kek, kek_version, lookup_key, lookup_key_version)
);
""".strip()

COUNT_KEYS_SQL = "SELECT COUNT(*) AS n FROM encryption_keys"

INSERT_VERSION_1_SQL = """
INSERT INTO encryption_keys (kek, kek_version, lookup_key, lookup_key_version, created_at, created_by)
VALUES (?, 1, ?, 1, datetime('now'), ?)
""".strip()

SELECT_KEYS_SQL = (
    "SELECT kek, kek_version, lookup_key, lookup_key_version FROM encryption_keys"
)


class D1Error(Exception):
    pass


@dataclass(frozen=True)
class D1Database:
    uuid: str
    name: str


@dataclass(frozen=True)
class EncryptionKeys:
    kek: bytes
    kek_version: int
    lookup_key: bytes
    lookup_key_version: int


@dataclass(frozen=True)
class CloudflareConfig:
    account_id: str
    api_token: str
    database_id: str | None = None
    database_name: str = DEFAULT_DATABASE_NAME


def list_databases(http: httpx.Client, config: CloudflareConfig) -> list[D1Database]:
    databases: list[D1Database] = []
    page = 1
    while True:
        query = urlencode({"page": page, "per_page": 100})
        url = f"{API_BASE}/accounts/{config.account_id}/d1/database?{query}"
        body = _get_json(http, url)
        rows = body.get("result")
        if not isinstance(rows, list):
            raise D1Error("Cloudflare D1 list response is invalid")
        for row in rows:
            if not isinstance(row, dict):
                continue
            uuid = row.get("uuid") or row.get("id")
            name = row.get("name")
            if isinstance(uuid, str) and isinstance(name, str):
                databases.append(D1Database(uuid=uuid, name=name))
        info = body.get("result_info")
        total_pages = 1
        if isinstance(info, dict) and isinstance(info.get("total_pages"), int):
            total_pages = max(info["total_pages"], 1)
        if page >= total_pages:
            break
        page += 1
    return databases


def create_database(http: httpx.Client, config: CloudflareConfig) -> D1Database:
    url = f"{API_BASE}/accounts/{config.account_id}/d1/database"
    body = _post_json(http, url, {"name": config.database_name})
    result = body.get("result")
    if not isinstance(result, dict):
        raise D1Error("Cloudflare D1 create response is invalid")
    uuid = result.get("uuid") or result.get("id")
    name = result.get("name") or config.database_name
    if not isinstance(uuid, str) or not isinstance(name, str):
        raise D1Error("Cloudflare D1 create response is missing uuid")
    return D1Database(uuid=uuid, name=name)


def query(
    http: httpx.Client,
    config: CloudflareConfig,
    database_id: str,
    sql: str,
    params: list[Any] | None = None,
) -> list[dict[str, Any]]:
    url = f"{API_BASE}/accounts/{config.account_id}/d1/database/{database_id}/query"
    payload: dict[str, Any] = {"sql": sql}
    if params is not None:
        payload["params"] = params
    body = _post_json(http, url, payload)
    result = body.get("result")
    if not isinstance(result, list) or not result or not isinstance(result[0], dict):
        raise D1Error("Cloudflare D1 query response is invalid")
    rows = result[0].get("results")
    if rows is None:
        return []
    if not isinstance(rows, list):
        raise D1Error("Cloudflare D1 query response is invalid")
    return [row for row in rows if isinstance(row, dict)]


def count_encryption_keys(
    http: httpx.Client, config: CloudflareConfig, database_id: str
) -> int:
    rows = query(http, config, database_id, COUNT_KEYS_SQL)
    if not rows:
        return 0
    value = rows[0].get("n")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise D1Error("Cloudflare D1 count response is invalid")
    return int(value)


def insert_version_1_keys(
    http: httpx.Client,
    config: CloudflareConfig,
    database_id: str,
    kek_b64: str,
    lookup_b64: str,
) -> None:
    query(
        http,
        config,
        database_id,
        INSERT_VERSION_1_SQL,
        [kek_b64, lookup_b64, CREATED_BY],
    )


def load_current_keys(
    http: httpx.Client, config: CloudflareConfig, database_id: str
) -> EncryptionKeys:
    rows = query(http, config, database_id, SELECT_KEYS_SQL)
    if not rows:
        raise D1Error("encryption_keys is empty")
    parsed: list[tuple[int, int, str, str]] = []
    for row in rows:
        kek = row.get("kek")
        lookup_key = row.get("lookup_key") if "lookup_key" in row else row.get("lookupKey")
        kek_version = _as_int(row.get("kek_version", row.get("kekVersion")))
        lookup_version = _as_int(
            row.get("lookup_key_version", row.get("lookupKeyVersion"))
        )
        if not isinstance(kek, str) or not isinstance(lookup_key, str):
            raise D1Error("encryption_keys row is invalid")
        if kek_version is None or lookup_version is None:
            raise D1Error("encryption_keys row is invalid")
        decode_aes_key(kek)
        decode_aes_key(lookup_key)
        parsed.append((kek_version, lookup_version, kek, lookup_key))
    parsed.sort(key=lambda item: (item[0], item[1]), reverse=True)
    kek_version, lookup_version, kek, lookup_key = parsed[0]
    return EncryptionKeys(
        kek=decode_aes_key(kek),
        kek_version=kek_version,
        lookup_key=decode_aes_key(lookup_key),
        lookup_key_version=lookup_version,
    )


def resolve_database(
    http: httpx.Client, config: CloudflareConfig
) -> D1Database | None:
    listed = list_databases(http, config)
    for database in listed:
        if database.name == config.database_name:
            return database
    if config.database_id:
        return D1Database(uuid=config.database_id, name=config.database_name)
    return None


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)


def _get_json(http: httpx.Client, url: str) -> dict[str, Any]:
    try:
        response = http.get(url)
    except httpx.HTTPError as exc:
        raise D1Error("Cloudflare D1 request failed") from exc
    return _parse_json(response)


def _post_json(http: httpx.Client, url: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        response = http.post(url, json=payload)
    except httpx.HTTPError as exc:
        raise D1Error("Cloudflare D1 request failed") from exc
    return _parse_json(response)


_D1_WRITE_HINT = (
    "The operator token needs D1 Write (Edit); do not reuse the worker query token"
)


def _parse_json(response: httpx.Response) -> dict[str, Any]:
    body: Any = None
    try:
        if response.content:
            body = response.json()
    except ValueError:
        body = None
    if response.status_code >= 400:
        raise D1Error(_format_http_error(response.status_code, body))
    if body is None:
        raise D1Error("Cloudflare D1 response is not JSON")
    if not isinstance(body, dict) or body.get("success") is False:
        raise D1Error(
            _format_api_error(body, "Cloudflare D1 request was not successful")
        )
    return body


def _format_http_error(status_code: int, body: Any) -> str:
    detail = _cloudflare_error_text(body)
    message = f"Cloudflare D1 HTTP {status_code}"
    if not detail:
        return message
    return _with_permission_hint(f"{message}: {detail}")


def _format_api_error(body: Any, fallback: str) -> str:
    detail = _cloudflare_error_text(body)
    if not detail:
        return fallback
    return _with_permission_hint(detail)


def _with_permission_hint(message: str) -> str:
    if "permission" in message.lower():
        return f"{message}. {_D1_WRITE_HINT}"
    return message


def _cloudflare_error_text(body: Any) -> str | None:
    if not isinstance(body, dict):
        return None
    errors = body.get("errors")
    if not isinstance(errors, list):
        return None
    parts: list[str] = []
    for item in errors:
        if not isinstance(item, dict):
            continue
        message = item.get("message")
        if isinstance(message, str) and message.strip():
            parts.append(message.strip())
    if not parts:
        return None
    return "; ".join(parts)
