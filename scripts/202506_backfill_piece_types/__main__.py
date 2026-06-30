"""
Backfill piece_type_id and piece_subtype_id for existing clothing items.

For each clothing item that was registered without a piece type or subtype,
the script infers the correct values from the item's title alone, then writes
them back to the database.

Usage
-----
    # from inside the script folder
    uv run python __main__.py

    # preview changes without committing them
    uv run python __main__.py --dry-run

    # point to a specific .env file
    uv run python __main__.py --env /path/to/.env

    # force-update items that already have a type/subtype assigned
    uv run python __main__.py --force

Exit codes
----------
    0  all items processed successfully (or --dry-run completed)
    1  a fatal error occurred (database connection failure, etc.)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Make scripts/utils importable regardless of cwd
# ---------------------------------------------------------------------------
_SCRIPTS_ROOT = Path(__file__).resolve().parent.parent
if str(_SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_ROOT))

from utils.db import get_connection               # noqa: E402
from utils.logger import Logger                    # noqa: E402
from utils.piece_classifier import classify_piece  # noqa: E402

_OUTPUT_FILE = Path(__file__).parent / "output.txt"
_UPDATED_BY = "script:202506_backfill_piece_types"


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def fetch_domains(conn) -> tuple[dict[str, str], dict[str, str]]:
    """
    Return two dicts mapping Domain.name → Domain.id for piece types and
    piece subtypes respectively.

    Returns
    -------
    (types, subtypes)
        ``types``    maps  e.g. ``"Top"``      → ``"218884b0-…"``
        ``subtypes`` maps  e.g. ``"T-Shirt"``  → ``"8e63a794-…"``
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, type FROM domains WHERE type IN ('piece_type', 'piece_subtype')"
        )
        rows = cur.fetchall()

    types: dict[str, str] = {}
    subtypes: dict[str, str] = {}
    for row_id, name, domain_type in rows:
        if domain_type == "piece_type":
            types[name] = str(row_id)
        else:
            subtypes[name] = str(row_id)

    return types, subtypes


def fetch_clothing_items(conn, force: bool) -> list[dict]:
    """
    Return clothing items that need classification.

    When *force* is False (default), only items where at least one of
    ``piece_type_id`` or ``piece_subtype_id`` is NULL are returned.
    When *force* is True, all items are returned.
    """
    where = "" if force else "WHERE piece_type_id IS NULL OR piece_subtype_id IS NULL"
    query = f"""
        SELECT id, title, piece_type_id, piece_subtype_id
          FROM clothing_items
        {where}
        ORDER BY title
    """
    with conn.cursor() as cur:
        cur.execute(query)
        rows = cur.fetchall()

    return [
        {
            "id": str(row[0]),
            "title": row[1],
            "piece_type_id": str(row[2]) if row[2] else None,
            "piece_subtype_id": str(row[3]) if row[3] else None,
        }
        for row in rows
    ]


def update_clothing_item(
    conn,
    item_id: str,
    piece_type_id: str | None,
    piece_subtype_id: str | None,
) -> None:
    """Persist the inferred type and subtype back to the database."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE clothing_items
               SET piece_type_id    = %s,
                   piece_subtype_id = %s,
                   updated_at       = NOW(),
                   updated_by       = %s
             WHERE id = %s
            """,
            (piece_type_id, piece_subtype_id, _UPDATED_BY, item_id),
        )


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def run(args: argparse.Namespace, log: Logger) -> int:
    log.info("Connecting to the database…")
    try:
        conn = get_connection(env_file=args.env)
    except Exception as exc:
        log.error(f"Failed to connect: {exc}")
        return 1

    log.info("Fetching domain lookup tables…")
    types, subtypes = fetch_domains(conn)
    log.info(f"Loaded {len(types)} piece types and {len(subtypes)} piece subtypes.")

    log.info(f"Fetching clothing items (force={args.force})…")
    items = fetch_clothing_items(conn, force=args.force)
    log.info(f"Found {len(items)} item(s) to process.")

    stats = {"updated": 0, "skipped": 0, "unclassified": 0}

    for item in items:
        title = item["title"]

        type_name, subtype_name = classify_piece(title)

        if type_name is None or subtype_name is None:
            log.warning(
                f"UNCLASSIFIED  id={item['id']}  title={title!r}"
            )
            stats["unclassified"] += 1
            continue

        new_type_id = types.get(type_name)
        new_subtype_id = subtypes.get(subtype_name)

        if new_type_id is None or new_subtype_id is None:
            log.warning(
                f"DOMAIN NOT FOUND  title={title!r}  "
                f"type={type_name!r} (id={new_type_id})  "
                f"subtype={subtype_name!r} (id={new_subtype_id})"
            )
            stats["skipped"] += 1
            continue

        prev_type_id = item["piece_type_id"]
        prev_subtype_id = item["piece_subtype_id"]
        change_marker = (
            "NEW    "
            if (prev_type_id is None and prev_subtype_id is None)
            else "UPDATE "
        )

        log.info(
            f"{change_marker} id={item['id']}  title={title!r}  "
            f"type={type_name!r}  subtype={subtype_name!r}"
        )

        if not args.dry_run:
            update_clothing_item(conn, item["id"], new_type_id, new_subtype_id)

        stats["updated"] += 1

    if not args.dry_run:
        conn.commit()
        log.info("Transaction committed.")
    else:
        log.info("Dry-run mode — no changes written to the database.")

    conn.close()

    log.info(
        f"Done.  updated={stats['updated']}  "
        f"skipped={stats['skipped']}  "
        f"unclassified={stats['unclassified']}"
    )
    return 0


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill piece_type_id and piece_subtype_id for existing clothing items.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the changes that would be made without applying them.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-classify all items, even those that already have a type/subtype.",
    )
    parser.add_argument(
        "--env",
        metavar="PATH",
        default=None,
        help="Path to a .env file containing DATABASE_URL_UNPOOLED / DATABASE_URL.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    _args = _parse_args()
    with Logger(output_file=_OUTPUT_FILE) as _log:
        _log.info(
            f"backfill-piece-types started  "
            f"dry_run={_args.dry_run}  force={_args.force}"
        )
        _code = run(_args, _log)
        _log.info(f"backfill-piece-types finished  exit_code={_code}")
    sys.exit(_code)
