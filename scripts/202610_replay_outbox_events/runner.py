"""
Reset outbox events to PENDING and re-dispatch them to worker-outbox-events.

Usage
-----
    cd scripts/202610_replay_outbox_events
    uv sync
    uv run python __main__.py <event-id> [<event-id> ...]
    uv run python __main__.py --dry-run <event-id> [<event-id> ...]

IDs may be space-separated, comma-separated, or mixed.

Exit codes
----------
    0  all events reset and dispatched (or --dry-run completed)
    1  a fatal error occurred (missing IDs, database, QStash, etc.)
"""
from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import UUID

from dotenv import load_dotenv

_SCRIPT_DIR = Path(__file__).resolve().parent
_SCRIPTS_ROOT = _SCRIPT_DIR.parent
if str(_SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_ROOT))

from qstash import (  # noqa: E402
    DEFAULT_QSTASH_URL,
    publish_process_outbox_events,
)
from utils.db import get_connection  # noqa: E402
from utils.logger import Logger  # noqa: E402

_OUTPUT_FILE = _SCRIPT_DIR / "output.txt"
_UPDATED_BY = "script:202610_replay_outbox_events"
_SCRIPT_NAME = "202610_replay_outbox_events"

PublishFn = Callable[..., int]
ConnectFn = Callable[..., Any]


@dataclass(frozen=True)
class OutboxEvent:
    id: str
    status: str


@dataclass(frozen=True)
class QStashConfig:
    token: str
    url: str
    worker_outbox_events_url: str


def load_dotenv_files(env_file: str | Path | None) -> None:
    if env_file is not None:
        load_dotenv(Path(env_file), override=False)
        return
    script_env = _SCRIPT_DIR / ".env"
    if script_env.exists():
        load_dotenv(script_env, override=False)
    load_dotenv(override=False)


def parse_event_ids(raw: Sequence[str]) -> list[str]:
    """Split on commas, strip, drop empties, and de-duplicate while preserving order."""
    seen: set[str] = set()
    ids: list[str] = []
    for chunk in raw:
        for part in chunk.split(","):
            event_id = part.strip()
            if not event_id or event_id in seen:
                continue
            seen.add(event_id)
            ids.append(event_id)
    return ids


def validate_event_ids(event_ids: Sequence[str]) -> list[str]:
    """Return invalid values that are not UUIDs."""
    invalid: list[str] = []
    for event_id in event_ids:
        try:
            UUID(event_id)
        except ValueError:
            invalid.append(event_id)
    return invalid


def load_qstash_config() -> QStashConfig:
    token = os.environ.get("QSTASH_TOKEN", "").strip()
    worker_url = os.environ.get("WORKER_OUTBOX_EVENTS_URL", "").strip()
    qstash_url = os.environ.get("QSTASH_URL", "").strip() or DEFAULT_QSTASH_URL
    missing: list[str] = []
    if not token:
        missing.append("QSTASH_TOKEN")
    if not worker_url:
        missing.append("WORKER_OUTBOX_EVENTS_URL")
    if missing:
        raise RuntimeError(
            "Missing required environment variables: " + ", ".join(missing)
        )
    return QStashConfig(
        token=token,
        url=qstash_url,
        worker_outbox_events_url=worker_url,
    )


def fetch_events(conn: Any, event_ids: Sequence[str]) -> list[OutboxEvent]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, status
              FROM outbox_events
             WHERE id = ANY(%s)
            """,
            (list(event_ids),),
        )
        rows = cur.fetchall()
    found = {str(row[0]): str(row[1]) for row in rows}
    return [
        OutboxEvent(id=event_id, status=found[event_id])
        for event_id in event_ids
        if event_id in found
    ]


def mark_events_pending(conn: Any, event_ids: Sequence[str]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE outbox_events
               SET status     = 'PENDING',
                   updated_at = NOW(),
                   updated_by = %s
             WHERE id = ANY(%s)
            """,
            (_UPDATED_BY, list(event_ids)),
        )


def missing_event_ids(requested: Sequence[str], found: Sequence[OutboxEvent]) -> list[str]:
    present = {event.id for event in found}
    return [event_id for event_id in requested if event_id not in present]


def run(
    args: argparse.Namespace,
    log: Logger,
    *,
    connect: ConnectFn = get_connection,
    publish: PublishFn = publish_process_outbox_events,
) -> int:
    event_ids = parse_event_ids(args.event_ids)
    if not event_ids:
        log.error("No event IDs provided.")
        return 1

    invalid = validate_event_ids(event_ids)
    if invalid:
        log.error("Invalid event ID(s) (expected UUID): " + ", ".join(invalid))
        return 1

    load_dotenv_files(args.env)

    log.info(f"Connecting to the database…  count={len(event_ids)}")
    try:
        conn = connect(env_file=args.env)
    except Exception as exc:
        log.error(f"Failed to connect: {exc}")
        return 1

    try:
        events = fetch_events(conn, event_ids)
        missing = missing_event_ids(event_ids, events)
        if missing:
            log.error("Event ID(s) not found in outbox_events: " + ", ".join(missing))
            return 1

        for event in events:
            log.info(f"FOUND  id={event.id}  status={event.status}")

        if args.dry_run:
            log.info("Dry-run mode — no database updates and no QStash publish.")
            return 0

        try:
            qstash = load_qstash_config()
        except Exception as exc:
            log.error(str(exc))
            return 1

        log.info("Updating events to PENDING…")
        mark_events_pending(conn, event_ids)
        conn.commit()
        log.info("Transaction committed.")

        log.info("Publishing to worker-outbox-events via QStash…")
        dispatched = publish(
            event_ids,
            qstash_token=qstash.token,
            worker_outbox_events_url=qstash.worker_outbox_events_url,
            qstash_url=qstash.url,
        )
        log.info(f"Done.  reset={len(event_ids)}  dispatched={dispatched}")
        return 0
    except Exception as exc:
        log.error(f"Replay failed: {exc}")
        return 1
    finally:
        conn.close()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Reset outbox events to PENDING and re-dispatch them to "
            "worker-outbox-events via QStash."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "event_ids",
        nargs="+",
        metavar="EVENT_ID",
        help="Outbox event UUID(s). Space-separated, comma-separated, or mixed.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Look up the events without updating them or calling worker-outbox-events.",
    )
    parser.add_argument(
        "--env",
        metavar="PATH",
        default=None,
        help="Path to a .env file with DATABASE_URL, QSTASH_TOKEN, WORKER_OUTBOX_EVENTS_URL.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    with Logger(output_file=_OUTPUT_FILE) as log:
        log.info(
            f"{_SCRIPT_NAME} started  "
            f"dry_run={args.dry_run}  event_count={len(parse_event_ids(args.event_ids))}"
        )
        code = run(args, log)
        log.info(f"{_SCRIPT_NAME} finished  exit_code={code}")
    return code
