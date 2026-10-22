"""In-memory Cloudflare D1 HTTP API for unit tests."""

from __future__ import annotations

import json
from typing import Any

import httpx

from envelope import encode_key


def json_response(body: dict[str, Any], status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=body)


class FakeD1:
    def __init__(
        self,
        *,
        databases: list[dict[str, str]] | None = None,
        keys: list[dict[str, Any]] | None = None,
    ) -> None:
        self.databases = list(databases or [])
        self.keys = list(keys or [])
        self.calls: list[tuple[str, str, dict[str, Any] | None]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body: dict[str, Any] | None = None
        if request.content:
            body = json.loads(request.content.decode("utf-8"))
        path = request.url.path
        self.calls.append((request.method, path, body))

        if request.method == "GET" and path.endswith("/d1/database"):
            return json_response(
                {
                    "success": True,
                    "result": self.databases,
                    "result_info": {"total_pages": 1},
                }
            )

        if request.method == "POST" and path.endswith("/d1/database"):
            assert body is not None
            created = {"uuid": "created-uuid-0001", "name": body["name"]}
            self.databases.append(created)
            return json_response({"success": True, "result": created})

        if request.method == "POST" and path.endswith("/query"):
            return self._query(body or {})

        return json_response({"success": False, "errors": [{"message": "unhandled"}]}, 400)

    def _query(self, body: dict[str, Any]) -> httpx.Response:
        sql = " ".join(str(body.get("sql", "")).split())
        params = body.get("params")
        upper = sql.upper()
        if "CREATE TABLE IF NOT EXISTS ENCRYPTION_KEYS" in upper:
            return json_response({"success": True, "result": [{"results": []}]})
        if "COUNT(*)" in upper:
            return json_response(
                {"success": True, "result": [{"results": [{"n": len(self.keys)}]}]}
            )
        if upper.startswith("INSERT INTO ENCRYPTION_KEYS"):
            kek, lookup_key, created_by = params
            self.keys.append(
                {
                    "kek": kek,
                    "kek_version": 1,
                    "lookup_key": lookup_key,
                    "lookup_key_version": 1,
                    "created_by": created_by,
                }
            )
            return json_response({"success": True, "result": [{"results": []}]})
        if "FROM ENCRYPTION_KEYS" in upper and upper.startswith("SELECT"):
            return json_response({"success": True, "result": [{"results": self.keys}]})
        return json_response({"success": False}, 400)

    def post_calls(self) -> list[tuple[str, str, dict[str, Any] | None]]:
        return [call for call in self.calls if call[0] == "POST"]

    def insert_calls(self) -> list[dict[str, Any]]:
        inserts: list[dict[str, Any]] = []
        for method, path, body in self.calls:
            if method != "POST" or not path.endswith("/query") or not body:
                continue
            sql = str(body.get("sql", "")).upper()
            if sql.strip().startswith("INSERT"):
                inserts.append(body)
        return inserts


def key_row(kek: bytes, lookup_key: bytes, *, kek_version: int = 1) -> dict[str, Any]:
    return {
        "kek": encode_key(kek),
        "kek_version": kek_version,
        "lookup_key": encode_key(lookup_key),
        "lookup_key_version": kek_version,
    }


def make_http(fake: FakeD1) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(fake))
