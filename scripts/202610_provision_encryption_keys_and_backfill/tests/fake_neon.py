"""In-memory Neon connection for backfill unit tests."""

from __future__ import annotations

import copy
import re
from typing import Any

_FROM = re.compile(r"FROM\s+(\w+)", re.IGNORECASE)
_UPDATE = re.compile(r"UPDATE\s+(\w+)\s+SET\s+(.*?)\s+WHERE", re.IGNORECASE | re.DOTALL)


class FakeCursor:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn
        self._rows: list[dict[str, Any]] = []
        self.rowcount = 0

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> None:
        sql = " ".join(query.split())
        self.conn.queries.append((sql, params))
        lower = sql.lower()
        if lower.startswith("select") and "for update" in lower:
            self._lock_row(sql, params)
            self.rowcount = len(self._rows)
            return
        if lower.startswith("select"):
            self._select_candidates(sql, params)
            self.rowcount = len(self._rows)
            return
        if lower.startswith("update"):
            self._update(sql, params)
            return

    def fetchall(self) -> list[dict[str, Any]]:
        return list(self._rows)

    def fetchone(self) -> dict[str, Any] | None:
        return self._rows[0] if self._rows else None

    def _lock_row(self, sql: str, params: tuple[Any, ...] | None) -> None:
        table = _table_from(sql)
        row_id = str(params[0]) if params else ""
        row = self.conn.tables.get(table, {}).get(row_id)
        if row is not None and row.get("dek") is None:
            self._rows = [copy.deepcopy(row)]
        else:
            self._rows = []

    def _select_candidates(self, sql: str, params: tuple[Any, ...] | None) -> None:
        table = _table_from(sql)
        listed = self.conn.listed_columns[table]
        rows: list[dict[str, Any]] = []
        for row in self.conn.tables.get(table, {}).values():
            if row.get("dek") is not None:
                continue
            if all(row.get(column) is None for column in listed):
                continue
            rows.append({"id": row["id"]})
        rows.sort(key=lambda item: str(item["id"]))
        if "limit" in sql.lower() and params:
            rows = rows[: int(params[0])]
        self._rows = rows

    def _update(self, sql: str, params: tuple[Any, ...] | None) -> None:
        table = _table_from_update(sql)
        assert params is not None
        row_id = str(params[-1])
        if row_id in self.conn.fail_update_ids:
            raise RuntimeError("unique violation")
        match = _UPDATE.search(sql)
        assert match is not None
        assignments = [part.split("=")[0].strip() for part in match.group(2).split(",")]
        updates = dict(zip(assignments, params[:-1], strict=True))
        row = self.conn.tables.get(table, {}).get(row_id)
        if row is None or row.get("dek") is not None:
            self.rowcount = 0
            return
        row.update(updates)
        self.rowcount = 1


class FakeTransaction:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn
        self._snapshot: dict[str, dict[str, dict[str, Any]]] | None = None

    def __enter__(self) -> FakeTransaction:
        self._snapshot = copy.deepcopy(self.conn.tables)
        return self

    def __exit__(self, exc_type: type[BaseException] | None, *_: object) -> None:
        if exc_type is not None and self._snapshot is not None:
            self.conn.tables = self._snapshot
        return None


class FakeConn:
    def __init__(
        self,
        tables: dict[str, dict[str, dict[str, Any]]],
        listed_columns: dict[str, tuple[str, ...]],
        fail_update_ids: set[str] | None = None,
    ) -> None:
        self.tables = tables
        self.listed_columns = listed_columns
        self.fail_update_ids = fail_update_ids or set()
        self.queries: list[tuple[str, tuple[Any, ...] | None]] = []
        self.closed = False
        self.autocommit = False
        self._baseline = copy.deepcopy(tables)

    def cursor(self, row_factory: Any = None) -> FakeCursor:
        return FakeCursor(self)

    def transaction(self) -> FakeTransaction:
        return FakeTransaction(self)

    def close(self) -> None:
        self.closed = True
        if not self.autocommit:
            self.tables = copy.deepcopy(self._baseline)

    def updates(self) -> list[tuple[str, tuple[Any, ...] | None]]:
        return [
            query
            for query in self.queries
            if query[0].lower().startswith("update")
        ]


def _table_from(sql: str) -> str:
    match = _FROM.search(sql)
    assert match is not None
    return match.group(1)


def _table_from_update(sql: str) -> str:
    match = re.search(r"UPDATE\s+(\w+)", sql, re.IGNORECASE)
    assert match is not None
    return match.group(1)
