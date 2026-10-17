# 202610 — Replay Outbox Events

Reset selected `outbox_events` rows to `PENDING` and re-dispatch each ID to
`worker-outbox-events` (`POST /process-outbox-event`) via QStash.

Use this to replay events that already reached `SUCCESS` or `ERROR`, or to
manually kick `PENDING` rows that never reached the worker.

---

## Prerequisites

| Tool | Version |
|------|---------|
| [uv](https://docs.astral.sh/uv/) | ≥ 0.4 |
| Python | ≥ 3.12 (managed by uv) |
| PostgreSQL | accessible via connection string |
| QStash token | publish access to `worker-outbox-events` |

---

## Setup

```bash
cd scripts/202610_replay_outbox_events
uv sync
cp .env.example .env
# fill in DATABASE_URL_UNPOOLED / DATABASE_URL, QSTASH_TOKEN, WORKER_OUTBOX_EVENTS_URL
```

---

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL_UNPOOLED` or `DATABASE_URL` | — | Postgres connection string |
| `QSTASH_TOKEN` | — | Outbound QStash publish |
| `QSTASH_URL` | `https://qstash.upstash.io` | QStash API origin |
| `WORKER_OUTBOX_EVENTS_URL` | — | Worker origin (no path); the script appends `/process-outbox-event` |

You can place `.env` in:

- this folder (`scripts/202610_replay_outbox_events/.env`)
- the current working directory when running the script
- or pass it explicitly via `--env`

`--dry-run` only needs the database URL. A real replay also needs `QSTASH_TOKEN`
and `WORKER_OUTBOX_EVENTS_URL`.

---

## Usage

```bash
cd scripts/202610_replay_outbox_events

# preview matching rows without writing or publishing
uv run python __main__.py --dry-run <event-id> [<event-id> ...]

# reset to PENDING and publish { outboxEventId } to worker-outbox-events
uv run python __main__.py <event-id> [<event-id> ...]

# comma-separated IDs are accepted too
uv run python __main__.py <event-id-1>,<event-id-2>

# use a .env file from a different location
uv run python __main__.py --env /path/to/.env <event-id>
```

Output is written to both **stdout** and **`output.txt`** (gitignored).

The worker only dispatches rows whose status is `PENDING`. The script therefore
updates first, commits, then publishes. If QStash publish fails after the
commit, the rows stay `PENDING` and the scheduled catch-up flow can pick them
up.

---

## Output format

Each line follows this pattern:

```
YYYY-MM-DD HH:MM:SS (UTC-3): [LEVEL] message
```

Example lines:

```
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] 202610_replay_outbox_events started  dry_run=False  event_count=2
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] FOUND  id=<uuid>  status=ERROR
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] Updating events to PENDING…
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] Publishing to worker-outbox-events via QStash…
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] Done.  reset=2  dispatched=2
```

---

## Database tables affected

| Table | Columns written |
|-------|-----------------|
| `outbox_events` | `status` (`PENDING`), `updated_at`, `updated_by` |

No rows are inserted or deleted.

---

## Shared utilities

Reusable helpers live under `scripts/utils/`:

| Module | Purpose |
|--------|---------|
| `db.py` | Database connection via `psycopg` (no ORM) |
| `logger.py` | Structured stdout / file logging |
