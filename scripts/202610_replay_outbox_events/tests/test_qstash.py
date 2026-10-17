"""QStash publish helpers."""

from __future__ import annotations

import json
import urllib.error
from io import BytesIO
from unittest.mock import patch

import pytest

from qstash import (
    BATCH_SIZE,
    build_batch_messages,
    post_json,
    publish_process_outbox_events,
    resolve_process_outbox_event_url,
)


def test_resolve_process_outbox_event_url_appends_path() -> None:
    assert (
        resolve_process_outbox_event_url(
            "https://worker-outbox-events.example.workers.dev"
        )
        == "https://worker-outbox-events.example.workers.dev/process-outbox-event"
    )


def test_resolve_process_outbox_event_url_strips_trailing_slash() -> None:
    assert (
        resolve_process_outbox_event_url(
            "https://worker-outbox-events.example.workers.dev/"
        )
        == "https://worker-outbox-events.example.workers.dev/process-outbox-event"
    )


def test_resolve_process_outbox_event_url_requires_origin() -> None:
    with pytest.raises(RuntimeError, match="WORKER_OUTBOX_EVENTS_URL"):
        resolve_process_outbox_event_url("   ")


def test_build_batch_messages_serializes_outbox_event_id() -> None:
    messages = build_batch_messages(
        "https://worker-outbox-events.example.workers.dev/process-outbox-event",
        ["evt-1", "evt-2"],
    )
    assert messages == [
        {
            "destination": "https://worker-outbox-events.example.workers.dev/process-outbox-event",
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"outboxEventId": "evt-1"}),
        },
        {
            "destination": "https://worker-outbox-events.example.workers.dev/process-outbox-event",
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"outboxEventId": "evt-2"}),
        },
    ]


def test_publish_returns_zero_and_does_not_post_for_empty_input() -> None:
    calls: list[tuple[str, str, object]] = []

    dispatched = publish_process_outbox_events(
        [],
        qstash_token="token",
        worker_outbox_events_url="https://worker-outbox-events.example.workers.dev",
        post=lambda url, token, body: calls.append((url, token, body)),
    )

    assert dispatched == 0
    assert calls == []


def test_publish_posts_one_batch_for_a_small_list() -> None:
    calls: list[tuple[str, str, object]] = []

    dispatched = publish_process_outbox_events(
        ["evt-1", "evt-2"],
        qstash_token="test-token",
        worker_outbox_events_url="https://worker-outbox-events.example.workers.dev",
        qstash_url="https://qstash.example",
        post=lambda url, token, body: calls.append((url, token, body)),
    )

    assert dispatched == 2
    assert len(calls) == 1
    url, token, body = calls[0]
    assert url == "https://qstash.example/v2/batch"
    assert token == "test-token"
    assert isinstance(body, list)
    assert len(body) == 2
    assert json.loads(body[0]["body"]) == {"outboxEventId": "evt-1"}


def test_post_json_region_mismatch_hints_at_qstash_url() -> None:
    error = urllib.error.HTTPError(
        url="https://qstash.upstash.io/v2/batch",
        code=404,
        msg="Not Found",
        hdrs=None,
        fp=BytesIO(
            b'{"error":"user (abc) not found in this region (eu-central-1). '
            b'Check that you are using the correct endpoint."}'
        ),
    )
    with patch("qstash.urllib.request.urlopen", side_effect=error):
        with pytest.raises(RuntimeError, match="QSTASH_URL") as exc_info:
            post_json("https://qstash.upstash.io/v2/batch", "token", [])
    assert "qstash-us-east-1.upstash.io" in str(exc_info.value)


def test_publish_chunks_at_qstash_batch_limit() -> None:
    calls: list[object] = []
    ids = [f"evt-{i}" for i in range(BATCH_SIZE + 1)]

    dispatched = publish_process_outbox_events(
        ids,
        qstash_token="token",
        worker_outbox_events_url="https://worker-outbox-events.example.workers.dev",
        post=lambda _url, _token, body: calls.append(body),
    )

    assert dispatched == BATCH_SIZE + 1
    assert len(calls) == 2
    assert len(calls[0]) == BATCH_SIZE
    assert len(calls[1]) == 1
