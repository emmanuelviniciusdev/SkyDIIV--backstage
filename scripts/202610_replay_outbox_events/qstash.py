"""Publish ``{ outboxEventId }`` messages to worker-outbox-events via QStash."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Callable, Sequence
from typing import Any
from urllib.parse import urljoin

DEFAULT_QSTASH_URL = "https://qstash.upstash.io"
PROCESS_OUTBOX_EVENT_PATH = "/process-outbox-event"
BATCH_SIZE = 100

PostJsonFn = Callable[[str, str, Any], None]


def resolve_process_outbox_event_url(worker_origin: str) -> str:
    """Append ``/process-outbox-event`` to the worker origin."""
    origin = worker_origin.strip()
    if not origin:
        raise RuntimeError("WORKER_OUTBOX_EVENTS_URL is not set")
    return urljoin(f"{origin.rstrip('/')}/", PROCESS_OUTBOX_EVENT_PATH.lstrip("/"))


def build_batch_messages(destination: str, event_ids: Sequence[str]) -> list[dict[str, Any]]:
    """Build a QStash ``/v2/batch`` payload for the given outbox event IDs."""
    return [
        {
            "destination": destination,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"outboxEventId": event_id}),
        }
        for event_id in event_ids
    ]


def post_json(url: str, token: str, body: Any, *, timeout_s: float = 60) -> None:
    payload = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=payload, method="POST")
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"QStash batch publish failed ({exc.code}): {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"QStash batch publish request failed: {exc}") from exc


def publish_process_outbox_events(
    event_ids: Sequence[str],
    *,
    qstash_token: str,
    worker_outbox_events_url: str,
    qstash_url: str = DEFAULT_QSTASH_URL,
    post: PostJsonFn = post_json,
) -> int:
    """
    Publish one QStash message per outbox event ID to ``/process-outbox-event``.

    Messages are batched in groups of ``BATCH_SIZE`` (QStash limit: 100/call).
    Returns the number of messages dispatched.
    """
    if not event_ids:
        return 0

    token = qstash_token.strip()
    if not token:
        raise RuntimeError("QSTASH_TOKEN is not set")

    destination = resolve_process_outbox_event_url(worker_outbox_events_url)
    origin = (qstash_url.strip() or DEFAULT_QSTASH_URL).rstrip("/")
    batch_url = f"{origin}/v2/batch"

    dispatched = 0
    ids = list(event_ids)
    for start in range(0, len(ids), BATCH_SIZE):
        batch = ids[start : start + BATCH_SIZE]
        post(batch_url, token, build_batch_messages(destination, batch))
        dispatched += len(batch)
    return dispatched
