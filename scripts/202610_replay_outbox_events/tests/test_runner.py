"""Replay CLI runner tests with a fake Postgres connection."""

from __future__ import annotations

from argparse import Namespace
from types import SimpleNamespace
from typing import Any

import pytest

from runner import (
    OutboxEvent,
    load_qstash_config,
    missing_event_ids,
    parse_args,
    parse_event_ids,
    run,
    validate_event_ids,
)
from utils.logger import Logger

ID_A = "11111111-1111-1111-1111-111111111111"
ID_B = "22222222-2222-2222-2222-222222222222"
ID_C = "33333333-3333-3333-3333-333333333333"


class _NullLog(Logger):
    def __init__(self) -> None:
        super().__init__(output_file=None)


class FakeCursor:
    def __init__(self, conn: "FakeConn") -> None:
        self.conn = conn
        self._rows: list[tuple[str, str]] = []

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> None:
        self.conn.queries.append((query, params))
        normalized = " ".join(query.split()).upper()
        if "SELECT" in normalized:
            ids = list(params[0]) if params else []
            self._rows = [
                (row["id"], row["status"])
                for row in self.conn.rows
                if row["id"] in ids
            ]
        elif "UPDATE" in normalized:
            ids = list(params[1]) if params else []
            for row in self.conn.rows:
                if row["id"] in ids:
                    row["status"] = "PENDING"
                    row["updated_by"] = params[0]

    def fetchall(self) -> list[tuple[str, str]]:
        return list(self._rows)


class FakeConn:
    def __init__(self, rows: list[dict[str, str]]) -> None:
        self.rows = rows
        self.queries: list[tuple[str, tuple[Any, ...] | None]] = []
        self.committed = False
        self.closed = False

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        self.committed = True

    def close(self) -> None:
        self.closed = True


def _args(*event_ids: str, dry_run: bool = False) -> Namespace:
    return Namespace(event_ids=list(event_ids), dry_run=dry_run, env=None)


def test_parse_event_ids_splits_commas_and_dedupes() -> None:
    assert parse_event_ids([f"{ID_A},{ID_B}", ID_B, f" {ID_C} "]) == [ID_A, ID_B, ID_C]


def test_parse_args_requires_at_least_one_id() -> None:
    with pytest.raises(SystemExit):
        parse_args([])


def test_parse_args_accepts_positional_ids() -> None:
    args = parse_args([ID_A, ID_B, "--dry-run"])
    assert args.event_ids == [ID_A, ID_B]
    assert args.dry_run is True


def test_validate_event_ids_rejects_non_uuids() -> None:
    assert validate_event_ids([ID_A, "not-a-uuid"]) == ["not-a-uuid"]
    assert validate_event_ids([ID_A, ID_B]) == []


def test_missing_event_ids_preserves_request_order() -> None:
    found = [OutboxEvent(id=ID_B, status="ERROR")]
    assert missing_event_ids([ID_A, ID_B, ID_C], found) == [ID_A, ID_C]


def test_load_qstash_config_requires_token_and_worker_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("QSTASH_TOKEN", raising=False)
    monkeypatch.delenv("WORKER_OUTBOX_EVENTS_URL", raising=False)
    with pytest.raises(RuntimeError, match="QSTASH_TOKEN"):
        load_qstash_config()


def test_load_qstash_config_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QSTASH_TOKEN", "token")
    monkeypatch.setenv("WORKER_OUTBOX_EVENTS_URL", "https://worker.example")
    monkeypatch.setenv("QSTASH_URL", "https://qstash.example")
    cfg = load_qstash_config()
    assert cfg.token == "token"
    assert cfg.worker_outbox_events_url == "https://worker.example"
    assert cfg.url == "https://qstash.example"


def test_dry_run_does_not_update_or_publish(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = FakeConn([{"id": ID_A, "status": "ERROR", "updated_by": None}])
    published: list[list[str]] = []

    code = run(
        _args(ID_A, dry_run=True),
        _NullLog(),
        connect=lambda env_file=None: conn,
        publish=lambda ids, **_: published.append(list(ids)) or 0,
    )

    assert code == 0
    assert conn.committed is False
    assert published == []
    assert conn.rows[0]["status"] == "ERROR"
    assert conn.closed is True


def test_run_rejects_unknown_ids() -> None:
    conn = FakeConn([{"id": ID_A, "status": "ERROR", "updated_by": None}])

    code = run(
        _args(ID_A, ID_B),
        _NullLog(),
        connect=lambda env_file=None: conn,
        publish=lambda *_args, **_kwargs: 0,
    )

    assert code == 1
    assert conn.committed is False
    assert conn.rows[0]["status"] == "ERROR"


def test_run_rejects_invalid_uuid_before_connecting() -> None:
    connected = False

    def connect(**_: object) -> FakeConn:
        nonlocal connected
        connected = True
        return FakeConn([])

    code = run(
        _args("not-a-uuid"),
        _NullLog(),
        connect=connect,
        publish=lambda *_args, **_kwargs: 0,
    )

    assert code == 1
    assert connected is False


def test_run_resets_pending_then_publishes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QSTASH_TOKEN", "token")
    monkeypatch.setenv("WORKER_OUTBOX_EVENTS_URL", "https://worker.example")
    conn = FakeConn(
        [
            {"id": ID_A, "status": "ERROR", "updated_by": None},
            {"id": ID_B, "status": "SUCCESS", "updated_by": None},
        ]
    )
    published: list[SimpleNamespace] = []

    def publish(ids: list[str], **kwargs: Any) -> int:
        published.append(SimpleNamespace(ids=list(ids), **kwargs))
        return len(ids)

    code = run(
        _args(ID_A, ID_B),
        _NullLog(),
        connect=lambda env_file=None: conn,
        publish=publish,
    )

    assert code == 0
    assert conn.committed is True
    assert {row["status"] for row in conn.rows} == {"PENDING"}
    assert {row["updated_by"] for row in conn.rows} == {"script:202610_replay_outbox_events"}
    assert published[0].ids == [ID_A, ID_B]
    assert published[0].qstash_token == "token"
    assert published[0].worker_outbox_events_url == "https://worker.example"
    assert conn.closed is True


def test_run_does_not_update_when_qstash_config_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("QSTASH_TOKEN", raising=False)
    monkeypatch.delenv("WORKER_OUTBOX_EVENTS_URL", raising=False)
    conn = FakeConn([{"id": ID_A, "status": "ERROR", "updated_by": None}])

    code = run(
        _args(ID_A),
        _NullLog(),
        connect=lambda env_file=None: conn,
        publish=lambda *_args, **_kwargs: 0,
    )

    assert code == 1
    assert conn.committed is False
    assert conn.rows[0]["status"] == "ERROR"


def test_run_returns_error_when_publish_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QSTASH_TOKEN", "token")
    monkeypatch.setenv("WORKER_OUTBOX_EVENTS_URL", "https://worker.example")
    conn = FakeConn([{"id": ID_A, "status": "ERROR", "updated_by": None}])

    def publish(*_args: object, **_kwargs: object) -> int:
        raise RuntimeError("QStash batch publish failed (401)")

    code = run(
        _args(ID_A),
        _NullLog(),
        connect=lambda env_file=None: conn,
        publish=publish,
    )

    assert code == 1
    assert conn.committed is True
    assert conn.rows[0]["status"] == "PENDING"
    assert conn.closed is True
