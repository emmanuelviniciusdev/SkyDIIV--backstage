"""
Migrate R2 asset URLs from skydiiv.space to assets.skydiiv.space.

Updates image_url in clothing_items (piece photos) and outfits (composite
thumbnails) wherever the old bare domain is still referenced.

Usage
-----
    # from inside the script folder
    uv run python __main__.py

    # preview changes without committing them
    uv run python __main__.py --dry-run

    # point to a specific .env file
    uv run python __main__.py --env /path/to/.env

Exit codes
----------
    0  all rows processed successfully (or --dry-run completed)
    1  a fatal error occurred (database connection failure, etc.)
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Make scripts/utils importable regardless of cwd
# ---------------------------------------------------------------------------
_SCRIPTS_ROOT = Path(__file__).resolve().parent.parent
if str(_SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_ROOT))

from utils.db import get_connection  # noqa: E402
from utils.logger import Logger  # noqa: E402

_OUTPUT_FILE = Path(__file__).parent / "output.txt"
_UPDATED_BY = "script:202607_migrate_asset_domain"

# Matches https://skydiiv.space/... or http://skydiiv.space/... only.
# Subdomains such as assets.skydiiv.space or www.skydiiv.space are untouched.
_OLD_HOST_RE = re.compile(r"(https?://)skydiiv\.space(?=/|$)", re.IGNORECASE)

_TABLES: tuple[tuple[str, str], ...] = (
    ("clothing_items", "clothing piece"),
    ("outfits", "outfit"),
)


def migrate_url(url: str) -> str | None:
    """
    Return the migrated URL when the host is the bare skydiiv.space domain.

    Returns None when no change is required.
    """
    migrated = _OLD_HOST_RE.sub(r"\1assets.skydiiv.space", url)
    return migrated if migrated != url else None


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def fetch_rows_with_old_domain(conn, table: str) -> list[dict]:
    """Return rows whose image_url still points at the old asset domain."""
    query = f"""
        SELECT id, image_url
          FROM {table}
         WHERE image_url IS NOT NULL
           AND (
             image_url ILIKE 'https://skydiiv.space/%'
             OR image_url ILIKE 'http://skydiiv.space/%'
             OR image_url ILIKE 'https://skydiiv.space'
             OR image_url ILIKE 'http://skydiiv.space'
           )
         ORDER BY id
    """
    with conn.cursor() as cur:
        cur.execute(query)
        rows = cur.fetchall()

    return [
        {"id": str(row[0]), "image_url": row[1]}
        for row in rows
    ]


def update_image_url(conn, table: str, row_id: str, image_url: str) -> None:
    """Persist the migrated image URL back to the database."""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE {table}
               SET image_url  = %s,
                   updated_at = NOW(),
                   updated_by = %s
             WHERE id = %s
            """,
            (image_url, _UPDATED_BY, row_id),
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

    stats = {"updated": 0, "skipped": 0}

    for table, label in _TABLES:
        log.info(f"Scanning {table} ({label} images)…")
        rows = fetch_rows_with_old_domain(conn, table)
        log.info(f"Found {len(rows)} {label} row(s) with the old domain.")

        for row in rows:
            old_url = row["image_url"]
            new_url = migrate_url(old_url)

            if new_url is None:
                log.warning(
                    f"SKIP  table={table}  id={row['id']}  "
                    f"url={old_url!r}  reason=no_migration_applied"
                )
                stats["skipped"] += 1
                continue

            log.info(
                f"UPDATE  table={table}  id={row['id']}\n"
                f"          old={old_url}\n"
                f"          new={new_url}"
            )

            if not args.dry_run:
                update_image_url(conn, table, row["id"], new_url)

            stats["updated"] += 1

    if not args.dry_run:
        conn.commit()
        log.info("Transaction committed.")
    else:
        log.info("Dry-run mode — no changes written to the database.")

    conn.close()

    log.info(
        f"Done.  updated={stats['updated']}  skipped={stats['skipped']}"
    )
    return 0


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Migrate image_url values from skydiiv.space to assets.skydiiv.space "
            "in clothing_items and outfits."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the changes that would be made without applying them.",
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
            f"202607_migrate_asset_domain started  dry_run={_args.dry_run}"
        )
        _code = run(_args, _log)
        _log.info(f"202607_migrate_asset_domain finished  exit_code={_code}")
    sys.exit(_code)
