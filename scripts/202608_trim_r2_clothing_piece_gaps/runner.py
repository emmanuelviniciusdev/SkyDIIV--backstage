"""
Backup clothing-pieces in R2, crop transparent padding, purge CDN.

Usage
-----
    cd scripts/202608_trim_r2_clothing_piece_gaps
    uv sync
    uv run python __main__.py --dry-run
    uv run python __main__.py

Exit codes
----------
    0  completed successfully (or dry-run finished)
    1  fatal error
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import boto3
from botocore.client import BaseClient
from botocore.exceptions import ClientError
from dotenv import load_dotenv

_SCRIPTS_ROOT = Path(__file__).resolve().parent.parent
if str(_SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_ROOT))

from keys import (  # noqa: E402
    LIVE_PREFIX,
    backup_dest_key,
    backup_prefix_for_date,
    is_folder_marker,
    is_live_clothing_piece_key,
)
from purge import (  # noqa: E402
    DEFAULT_PUBLIC_URL,
    PurgePostFn,
    post_purge,
    purge_body,
    purge_prefix_from_public_url,
)
from trim_image import TrimDecodeError, try_trim_piece  # noqa: E402
from utils.logger import Logger  # noqa: E402

_OUTPUT_FILE = Path(__file__).parent / "output.txt"
_DEFAULT_BUCKET = "skydiiv--production--assets"


@dataclass
class Config:
    endpoint: str
    access_key_id: str
    secret_access_key: str
    bucket: str
    public_url: str
    cloudflare_api_token: str
    cloudflare_zone_id: str


def load_dotenv_files(env_file: str | Path | None) -> None:
    if env_file is not None:
        load_dotenv(Path(env_file), override=False)
        return
    script_env = Path(__file__).parent / ".env"
    if script_env.exists():
        load_dotenv(script_env, override=False)
    load_dotenv(override=False)


def load_config(env_file: str | Path | None) -> Config:
    load_dotenv_files(env_file)

    account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    endpoint = os.environ.get("R2_ENDPOINT", "").strip().rstrip("/")
    if not endpoint and account_id:
        endpoint = f"https://{account_id}.r2.cloudflarestorage.com"

    return Config(
        endpoint=endpoint,
        access_key_id=os.environ.get("R2_ACCESS_KEY_ID", "").strip(),
        secret_access_key=os.environ.get("R2_SECRET_ACCESS_KEY", "").strip(),
        bucket=os.environ.get("R2_BUCKET", "").strip() or _DEFAULT_BUCKET,
        public_url=(
            os.environ.get("R2_PUBLIC_URL", "").strip().rstrip("/") or DEFAULT_PUBLIC_URL
        ),
        cloudflare_api_token=os.environ.get("CLOUDFLARE_API_TOKEN", "").strip(),
        cloudflare_zone_id=os.environ.get("CLOUDFLARE_ZONE_ID", "").strip(),
    )


def missing_purge_credentials(cfg: Config) -> list[str]:
    missing: list[str] = []
    if not cfg.cloudflare_api_token:
        missing.append("CLOUDFLARE_API_TOKEN")
    if not cfg.cloudflare_zone_id:
        missing.append("CLOUDFLARE_ZONE_ID")
    return missing


def missing_r2_credentials(cfg: Config) -> list[str]:
    missing: list[str] = []
    if not cfg.endpoint:
        missing.append("R2_ENDPOINT or R2_ACCOUNT_ID")
    if not cfg.access_key_id:
        missing.append("R2_ACCESS_KEY_ID")
    if not cfg.secret_access_key:
        missing.append("R2_SECRET_ACCESS_KEY")
    return missing


def create_r2_client(cfg: Config) -> BaseClient:
    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint,
        aws_access_key_id=cfg.access_key_id,
        aws_secret_access_key=cfg.secret_access_key,
        region_name="auto",
    )


def list_object_keys(
    client: Any,
    bucket: str,
    *,
    prefix: str,
) -> list[str]:
    keys: list[str] = []
    token: str | None = None
    while True:
        kwargs: dict[str, Any] = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        response = client.list_objects_v2(**kwargs)
        for item in response.get("Contents") or []:
            key = item.get("Key")
            if isinstance(key, str) and not is_folder_marker(key):
                keys.append(key)
        if not response.get("IsTruncated"):
            break
        token = response.get("NextContinuationToken")
    return keys


def list_live_keys(client: Any, bucket: str) -> list[str]:
    keys = [
        key
        for key in list_object_keys(client, bucket, prefix=LIVE_PREFIX)
        if is_live_clothing_piece_key(key)
    ]
    keys.sort()
    return keys


def prefix_has_objects(client: Any, bucket: str, prefix: str) -> bool:
    return bool(list_object_keys(client, bucket, prefix=prefix))


def copy_object(
    client: Any,
    *,
    bucket: str,
    source_key: str,
    dest_key: str,
) -> None:
    client.copy_object(
        Bucket=bucket,
        Key=dest_key,
        CopySource={"Bucket": bucket, "Key": source_key},
        MetadataDirective="COPY",
    )


def get_object_bytes(client: Any, bucket: str, key: str) -> bytes:
    response = client.get_object(Bucket=bucket, Key=key)
    return response["Body"].read()


def put_png(client: Any, bucket: str, key: str, body: bytes) -> None:
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="image/png",
    )


def backup_keys(
    client: Any,
    bucket: str,
    keys: list[str],
    date_str: str,
    log: Logger,
    *,
    dry_run: bool,
) -> int:
    errors = 0
    for source_key in keys:
        dest_key = backup_dest_key(source_key, date_str)
        log.info(f"COPY  {source_key}\n   ->  {dest_key}")
        if dry_run:
            continue
        try:
            copy_object(client, bucket=bucket, source_key=source_key, dest_key=dest_key)
        except ClientError as exc:
            log.error(f"FAILED  backup key={source_key!r}  error={exc}")
            errors += 1
    return errors


def trim_keys(
    client: Any,
    bucket: str,
    keys: list[str],
    log: Logger,
    *,
    dry_run: bool,
) -> int:
    errors = 0
    for key in keys:
        log.info(f"TRIM  key={key!r}")
        if dry_run:
            continue
        try:
            original = get_object_bytes(client, bucket, key)
            cropped = try_trim_piece(original)
        except (ClientError, TrimDecodeError, OSError) as exc:
            log.error(f"FAILED  trim key={key!r}  error={exc}")
            errors += 1
            continue

        if cropped is None:
            log.info(f"SKIP  key={key!r}  reason=unchanged_or_ineligible")
            continue

        try:
            put_png(client, bucket, key, cropped)
            log.info(f"PUT   key={key!r}  content_type=image/png")
        except ClientError as exc:
            log.error(f"FAILED  put key={key!r}  error={exc}")
            errors += 1
    return errors


def run_purge(
    cfg: Config,
    log: Logger,
    *,
    dry_run: bool,
    purge_post: PurgePostFn | None,
) -> int:
    prefix = purge_prefix_from_public_url(cfg.public_url)
    body = purge_body(prefix)
    log.info(f"PURGE  {body!r}")
    if dry_run:
        return 0
    poster = purge_post or post_purge
    try:
        poster(cfg.cloudflare_zone_id, cfg.cloudflare_api_token, body)
    except Exception as exc:
        log.error(f"FAILED  purge  error={exc}")
        return 1
    log.info("PURGE  ok")
    return 0


def run(
    args: argparse.Namespace,
    log: Logger,
    *,
    config: Config | None = None,
    r2_client: Any | None = None,
    today: date | None = None,
    purge_post: PurgePostFn | None = None,
    connect_r2: bool = True,
) -> int:
    cfg = config or load_config(getattr(args, "env", None))
    dry_run = bool(args.dry_run)
    purge_only = bool(args.purge_only)

    if purge_only:
        missing = missing_purge_credentials(cfg)
        if missing:
            log.error(f"Missing purge credentials: {', '.join(missing)}")
            return 1
        return run_purge(cfg, log, dry_run=False, purge_post=purge_post)

    if not dry_run:
        missing = missing_purge_credentials(cfg)
        if missing:
            log.error(
                "Missing purge credentials (aborting before R2 writes): "
                + ", ".join(missing)
            )
            return 1

    if r2_client is None:
        missing_r2 = missing_r2_credentials(cfg)
        if missing_r2:
            log.error(f"Missing R2 credentials: {', '.join(missing_r2)}")
            return 1
        if connect_r2:
            try:
                r2_client = create_r2_client(cfg)
                r2_client.head_bucket(Bucket=cfg.bucket)
            except Exception as exc:
                log.error(f"Failed to connect to R2 / verify bucket: {exc}")
                return 1

    date_str = (today or date.today()).isoformat()
    backup_prefix = backup_prefix_for_date(date_str)
    log.info(
        f"Config  bucket={cfg.bucket!r}  backup_prefix={backup_prefix!r}  "
        f"dry_run={dry_run}  skip_backup={args.skip_backup}  limit={args.limit}"
    )

    keys = list_live_keys(r2_client, cfg.bucket)
    if args.limit is not None:
        keys = keys[: int(args.limit)]
    log.info(f"Found {len(keys)} live clothing-piece object(s).")

    if not args.skip_backup:
        if prefix_has_objects(r2_client, cfg.bucket, backup_prefix):
            log.error(
                f"Backup prefix already occupied: {backup_prefix!r}. "
                "Aborting. Use --skip-backup after verifying the snapshot."
            )
            return 1
        backup_errors = backup_keys(
            r2_client, cfg.bucket, keys, date_str, log, dry_run=dry_run
        )
        if backup_errors:
            log.error("Aborting before trim because some backup copies failed.")
            return 1
    else:
        log.info("Skipping backup (--skip-backup).")

    trim_errors = trim_keys(r2_client, cfg.bucket, keys, log, dry_run=dry_run)
    purge_errors = run_purge(cfg, log, dry_run=dry_run, purge_post=purge_post)

    log.info(f"Done.  trim_errors={trim_errors}  purge_errors={purge_errors}")
    if trim_errors or purge_errors:
        return 1
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Backup clothing-pieces/ in R2, crop transparent PNG/WebP padding, "
            "and purge assets.skydiiv.space/clothing-pieces."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log planned backup copies, trims, and purge without applying them.",
    )
    parser.add_argument(
        "--env",
        metavar="PATH",
        default=None,
        help="Path to a .env file with R2 + Cloudflare settings.",
    )
    parser.add_argument(
        "--skip-backup",
        action="store_true",
        help="Skip the prefix copy (resume after a completed backup).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Process only the first N listed live keys.",
    )
    parser.add_argument(
        "--purge-only",
        action="store_true",
        help="Only call Cloudflare Instant Purge (no R2 copy or put).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    with Logger(output_file=_OUTPUT_FILE) as log:
        log.info(
            "202608_trim_r2_clothing_piece_gaps started  "
            f"dry_run={args.dry_run}  purge_only={args.purge_only}"
        )
        code = run(args, log)
        log.info(f"202608_trim_r2_clothing_piece_gaps finished  exit_code={code}")
    return code
