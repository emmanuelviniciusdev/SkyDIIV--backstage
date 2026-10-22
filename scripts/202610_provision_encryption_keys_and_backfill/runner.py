"""
Provision Cloudflare D1 encryption_keys and backfill listed Neon columns.

Usage
-----
    cd scripts/202610_provision_encryption_keys_and_backfill
    uv sync
    uv run python __main__.py provision --dry-run
    uv run python __main__.py provision
    uv run python __main__.py backfill --dry-run --limit 5
    uv run python __main__.py backfill --table users --limit 20
    uv run python __main__.py backfill

Exit codes
----------
    0  completed (or --dry-run finished)
    1  fatal error (missing env, D1, Neon connection, …)
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

_SCRIPT_DIR = Path(__file__).resolve().parent
_SCRIPTS_ROOT = _SCRIPT_DIR.parent
if str(_SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_ROOT))

from backfill import backfill  # noqa: E402
from d1 import DEFAULT_DATABASE_NAME, CloudflareConfig  # noqa: E402
from provision import provision  # noqa: E402
from utils.db import get_connection  # noqa: E402
from utils.logger import Logger  # noqa: E402

_OUTPUT_FILE = _SCRIPT_DIR / "output.txt"
_SCRIPT_NAME = "202610_provision_encryption_keys_and_backfill"


def load_dotenv_files(env_file: str | Path | None) -> None:
    if env_file is not None:
        load_dotenv(Path(env_file), override=False)
        return
    script_env = _SCRIPT_DIR / ".env"
    if script_env.exists():
        load_dotenv(script_env, override=False)
    load_dotenv(override=False)


def load_cloudflare_config() -> CloudflareConfig:
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    token = os.environ.get("CLOUDFLARE_D1_API_TOKEN", "").strip()
    database_id = os.environ.get("CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID", "").strip() or None
    name = os.environ.get("D1_DATABASE_NAME", "").strip() or DEFAULT_DATABASE_NAME
    missing: list[str] = []
    if not account_id:
        missing.append("CLOUDFLARE_ACCOUNT_ID")
    if not token:
        missing.append("CLOUDFLARE_D1_API_TOKEN")
    if missing:
        raise RuntimeError("Missing required environment variables: " + ", ".join(missing))
    return CloudflareConfig(
        account_id=account_id,
        api_token=token,
        database_id=database_id,
        database_name=name,
    )


def make_http(config: CloudflareConfig) -> httpx.Client:
    return httpx.Client(
        headers={
            "Authorization": f"Bearer {config.api_token}",
            "Content-Type": "application/json",
        },
        timeout=30.0,
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Provision Cloudflare D1 encryption_keys and backfill listed Neon columns."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    provision_parser = sub.add_parser(
        "provision",
        help="Create or reuse D1 skydiiv--production and insert version-1 keys if empty.",
    )
    _add_shared_flags(provision_parser)

    backfill_parser = sub.add_parser(
        "backfill",
        help="Seal Neon rows with dek IS NULL using current D1 keys.",
    )
    _add_shared_flags(backfill_parser)
    backfill_parser.add_argument(
        "--limit",
        metavar="N",
        type=int,
        default=None,
        help="Cap sealed (or would-seal) rows per table.",
    )
    backfill_parser.add_argument(
        "--table",
        metavar="NAME",
        default=None,
        help="Restrict to one listed table (e.g. users).",
    )
    return parser.parse_args(argv)


def _add_shared_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log D1/Neon actions without creating databases, inserting keys, or UPDATEs.",
    )
    parser.add_argument(
        "--env",
        metavar="PATH",
        default=None,
        help="Path to a .env file.",
    )


def run(args: argparse.Namespace, log: Logger) -> int:
    load_dotenv_files(args.env)
    try:
        config = load_cloudflare_config()
    except Exception as exc:
        log.error(str(exc))
        return 1

    with make_http(config) as http:
        if args.command == "provision":
            return provision(config=config, http=http, log=log, dry_run=args.dry_run)
        return backfill(
            config=config,
            http=http,
            log=log,
            dry_run=args.dry_run,
            connect=get_connection,
            limit=args.limit,
            table=args.table,
            env_file=args.env,
        )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    with Logger(output_file=_OUTPUT_FILE) as log:
        extra = ""
        if args.command == "backfill":
            extra = f"  limit={args.limit}  table={args.table}"
        log.info(f"{_SCRIPT_NAME} started  command={args.command}  dry_run={args.dry_run}{extra}")
        code = run(args, log)
        log.info(f"{_SCRIPT_NAME} finished  exit_code={code}")
    return code
