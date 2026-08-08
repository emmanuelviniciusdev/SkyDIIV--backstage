"""
Copy R2 assets to ``skydiiv--production--assets`` and rewrite piece URLs.

1. Copy every object from the source bucket to the destination bucket
   (source objects are left in place — delete the old bucket manually later).
   - Root keys (piece images) → ``clothing-pieces/<key>``
   - Keys already under ``outfits/`` or ``clothing-pieces/`` keep the same path
2. Update ``clothing_items.image_url`` so root-relative piece paths gain the
   ``clothing-pieces/`` prefix (host stays the same unless the URL is under
   ``R2_PUBLIC_URL`` and you only need a path rewrite).

Usage
-----
    cd scripts/202608_migrate_r2_production_assets
    uv sync
    uv run python __main__.py --dry-run
    uv run python __main__.py

    # R2 only / DB only
    uv run python __main__.py --skip-db
    uv run python __main__.py --skip-r2

Exit codes
----------
    0  completed successfully (or dry-run finished)
    1  fatal error
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

import boto3
from botocore.client import BaseClient
from botocore.exceptions import ClientError
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Make scripts/utils importable regardless of cwd
# ---------------------------------------------------------------------------
_SCRIPTS_ROOT = Path(__file__).resolve().parent.parent
if str(_SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_ROOT))

from utils.db import get_connection  # noqa: E402
from utils.logger import Logger  # noqa: E402

_OUTPUT_FILE = Path(__file__).parent / "output.txt"
_UPDATED_BY = "script:202608_migrate_r2_production_assets"

_DEFAULT_SOURCE_BUCKET = "skydiiv-clothing-pieces"
_DEFAULT_DEST_BUCKET = "skydiiv--production--assets"
_KNOWN_PREFIXES = ("outfits/", "clothing-pieces/")


# ---------------------------------------------------------------------------
# Key / URL helpers
# ---------------------------------------------------------------------------

def map_dest_key(source_key: str) -> str:
    """
    Map a source object key to its destination key.

    Root objects become ``clothing-pieces/<name>``. Prefixed objects keep their path.
    """
    if not source_key or source_key.endswith("/"):
        return source_key
    if source_key.startswith(_KNOWN_PREFIXES):
        return source_key
    return f"clothing-pieces/{source_key}"


def extract_object_key(url: str, public_base: str | None) -> str | None:
    """
    Derive the R2 object key from a stored image URL.

    Prefer stripping ``R2_PUBLIC_URL`` when the URL is under that base; otherwise
    use the URL path (leading slash removed).
    """
    if not url:
        return None

    if public_base:
        base = public_base.rstrip("/")
        if url.startswith(base + "/"):
            return url[len(base) + 1 :]
        if url == base:
            return None

    parsed = urlparse(url)
    path = parsed.path.lstrip("/")
    return path or None


def rewrite_image_url(url: str, public_base: str | None) -> str | None:
    """
    Return a rewritten URL when the object key needs a ``clothing-pieces/`` prefix.

    Returns None when no change is required.
    """
    key = extract_object_key(url, public_base)
    if key is None:
        return None

    new_key = map_dest_key(key)
    if new_key == key:
        return None

    if public_base and url.startswith(public_base.rstrip("/") + "/"):
        return f"{public_base.rstrip('/')}/{new_key}"

    parsed = urlparse(url)
    new_path = "/" + new_key
    return urlunparse(parsed._replace(path=new_path))


# ---------------------------------------------------------------------------
# R2 client
# ---------------------------------------------------------------------------

def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def load_r2_config(env_file: str | Path | None) -> dict[str, str]:
    if env_file is not None:
        load_dotenv(Path(env_file), override=False)
    else:
        # Prefer .env next to this script, then cwd.
        script_env = Path(__file__).parent / ".env"
        if script_env.exists():
            load_dotenv(script_env, override=False)
        load_dotenv(override=False)

    account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    endpoint = os.environ.get("R2_ENDPOINT", "").strip().rstrip("/")
    if not endpoint:
        if not account_id:
            raise RuntimeError("Set R2_ENDPOINT or R2_ACCOUNT_ID")
        endpoint = f"https://{account_id}.r2.cloudflarestorage.com"

    return {
        "endpoint": endpoint,
        "access_key_id": _require_env("R2_ACCESS_KEY_ID"),
        "secret_access_key": _require_env("R2_SECRET_ACCESS_KEY"),
        "source_bucket": os.environ.get("R2_SOURCE_BUCKET", _DEFAULT_SOURCE_BUCKET).strip()
        or _DEFAULT_SOURCE_BUCKET,
        "dest_bucket": os.environ.get("R2_DEST_BUCKET", _DEFAULT_DEST_BUCKET).strip()
        or _DEFAULT_DEST_BUCKET,
        "public_url": os.environ.get("R2_PUBLIC_URL", "").strip().rstrip("/"),
    }


def create_r2_client(cfg: dict[str, str]) -> BaseClient:
    return boto3.client(
        "s3",
        endpoint_url=cfg["endpoint"],
        aws_access_key_id=cfg["access_key_id"],
        aws_secret_access_key=cfg["secret_access_key"],
        region_name="auto",
    )


def list_object_keys(client: BaseClient, bucket: str) -> list[str]:
    keys: list[str] = []
    token: str | None = None
    while True:
        kwargs: dict[str, Any] = {"Bucket": bucket, "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        response = client.list_objects_v2(**kwargs)
        for item in response.get("Contents") or []:
            key = item.get("Key")
            if isinstance(key, str) and key and not key.endswith("/"):
                keys.append(key)
        if not response.get("IsTruncated"):
            break
        token = response.get("NextContinuationToken")
    return keys


def copy_object(
    client: BaseClient,
    *,
    source_bucket: str,
    dest_bucket: str,
    source_key: str,
    dest_key: str,
) -> None:
    client.copy_object(
        Bucket=dest_bucket,
        Key=dest_key,
        CopySource={"Bucket": source_bucket, "Key": source_key},
        MetadataDirective="COPY",
    )


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def fetch_clothing_item_urls(conn) -> list[dict[str, str]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, image_url
              FROM clothing_items
             WHERE image_url IS NOT NULL
               AND image_url <> ''
             ORDER BY id
            """
        )
        rows = cur.fetchall()
    return [{"id": str(row[0]), "image_url": row[1]} for row in rows]


def update_clothing_item_image_url(conn, row_id: str, image_url: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE clothing_items
               SET image_url  = %s,
                   updated_at = NOW(),
                   updated_by = %s
             WHERE id = %s
            """,
            (image_url, _UPDATED_BY, row_id),
        )


# ---------------------------------------------------------------------------
# Migration phases
# ---------------------------------------------------------------------------

def migrate_r2(
    client: BaseClient,
    cfg: dict[str, str],
    log: Logger,
    *,
    dry_run: bool,
) -> dict[str, int]:
    source = cfg["source_bucket"]
    dest = cfg["dest_bucket"]
    log.info(f"Listing objects in source bucket={source!r}…")
    keys = list_object_keys(client, source)
    log.info(f"Found {len(keys)} object(s) to copy.")

    stats = {"copied": 0, "skipped": 0, "errors": 0}

    for source_key in keys:
        dest_key = map_dest_key(source_key)
        if not dest_key or dest_key.endswith("/"):
            log.warning(f"SKIP  key={source_key!r}  reason=empty_or_folder_marker")
            stats["skipped"] += 1
            continue

        same_location = source == dest and source_key == dest_key
        if same_location:
            log.info(f"SKIP  key={source_key!r}  reason=already_at_destination")
            stats["skipped"] += 1
            continue

        log.info(
            f"COPY  {source}/{source_key}\n"
            f"   ->  {dest}/{dest_key}"
        )

        if dry_run:
            stats["copied"] += 1
            continue

        try:
            copy_object(
                client,
                source_bucket=source,
                dest_bucket=dest,
                source_key=source_key,
                dest_key=dest_key,
            )
            stats["copied"] += 1
        except ClientError as exc:
            log.error(f"FAILED  key={source_key!r}  error={exc}")
            stats["errors"] += 1

    return stats


def migrate_database(
    conn,
    public_url: str | None,
    log: Logger,
    *,
    dry_run: bool,
) -> dict[str, int]:
    log.info("Scanning clothing_items.image_url…")
    rows = fetch_clothing_item_urls(conn)
    log.info(f"Found {len(rows)} clothing_items row(s) with an image_url.")

    stats = {"updated": 0, "skipped": 0}

    for row in rows:
        old_url = row["image_url"]
        new_url = rewrite_image_url(old_url, public_url or None)

        if new_url is None:
            stats["skipped"] += 1
            continue

        log.info(
            f"UPDATE  table=clothing_items  id={row['id']}\n"
            f"          old={old_url}\n"
            f"          new={new_url}"
        )

        if not dry_run:
            update_clothing_item_image_url(conn, row["id"], new_url)

        stats["updated"] += 1

    if not dry_run:
        conn.commit()
        log.info("Database transaction committed.")
    else:
        log.info("Dry-run mode — no database changes written.")

    return stats


def run(args: argparse.Namespace, log: Logger) -> int:
    try:
        cfg = load_r2_config(args.env)
    except Exception as exc:
        log.error(f"Failed to load configuration: {exc}")
        return 1

    log.info(
        "Config  "
        f"source={cfg['source_bucket']!r}  dest={cfg['dest_bucket']!r}  "
        f"public_url={cfg['public_url'] or '(unset)'}  "
        f"dry_run={args.dry_run}  skip_r2={args.skip_r2}  skip_db={args.skip_db}"
    )

    r2_stats: dict[str, int] | None = None
    db_stats: dict[str, int] | None = None

    if not args.skip_r2:
        try:
            client = create_r2_client(cfg)
            # Cheap connectivity check
            client.head_bucket(Bucket=cfg["source_bucket"])
            client.head_bucket(Bucket=cfg["dest_bucket"])
        except Exception as exc:
            log.error(f"Failed to connect to R2 / verify buckets: {exc}")
            return 1

        r2_stats = migrate_r2(client, cfg, log, dry_run=args.dry_run)
        log.info(
            "R2 done.  "
            f"copied={r2_stats['copied']}  skipped={r2_stats['skipped']}  "
            f"errors={r2_stats['errors']}"
        )
        if r2_stats["errors"]:
            log.error("Aborting before database updates because some R2 copies failed.")
            return 1
    else:
        log.info("Skipping R2 object migration (--skip-r2).")

    if not args.skip_db:
        try:
            conn = get_connection(env_file=args.env)
        except Exception as exc:
            log.error(f"Failed to connect to the database: {exc}")
            return 1

        try:
            db_stats = migrate_database(
                conn,
                cfg["public_url"] or None,
                log,
                dry_run=args.dry_run,
            )
        finally:
            conn.close()

        log.info(
            "DB done.  "
            f"updated={db_stats['updated']}  skipped={db_stats['skipped']}"
        )
    else:
        log.info("Skipping database URL updates (--skip-db).")

    log.info(
        "Done.  "
        f"r2={r2_stats}  db={db_stats}"
    )
    return 0


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Copy R2 objects from skydiiv-clothing-pieces to "
            "skydiiv--production--assets (root → clothing-pieces/) and rewrite "
            "clothing_items.image_url paths. Does not delete from the source bucket."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log planned R2 copies and DB updates without applying them.",
    )
    parser.add_argument(
        "--env",
        metavar="PATH",
        default=None,
        help="Path to a .env file with R2 + DATABASE_URL settings.",
    )
    parser.add_argument(
        "--skip-r2",
        action="store_true",
        help="Only update clothing_items.image_url (no object copies).",
    )
    parser.add_argument(
        "--skip-db",
        action="store_true",
        help="Only copy R2 objects (no database updates).",
    )
    return parser.parse_args()


if __name__ == "__main__":
    _args = _parse_args()
    with Logger(output_file=_OUTPUT_FILE) as _log:
        _log.info(
            f"202608_migrate_r2_production_assets started  dry_run={_args.dry_run}"
        )
        _code = run(_args, _log)
        _log.info(
            f"202608_migrate_r2_production_assets finished  exit_code={_code}"
        )
    sys.exit(_code)
