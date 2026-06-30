"""
Database connection utility.

Loads the connection string from environment variables (optionally via a .env
file) and returns a psycopg connection.  Prefers DATABASE_URL_UNPOOLED for
direct connections so pooler session limits are not consumed by long-running
scripts.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING

import psycopg
from dotenv import load_dotenv

if TYPE_CHECKING:
    pass


def get_connection(env_file: str | Path | None = None) -> psycopg.Connection:
    """
    Return an open psycopg connection.

    Resolution order for the connection string:
    1. *env_file* argument (explicit path to a .env file)
    2. .env in the current working directory
    3. DATABASE_URL_UNPOOLED environment variable already set in the shell
    4. DATABASE_URL environment variable already set in the shell

    Raises RuntimeError if no connection string can be found.
    """
    if env_file is not None:
        load_dotenv(Path(env_file))
    else:
        load_dotenv()

    url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "No database URL found. "
            "Set DATABASE_URL_UNPOOLED (or DATABASE_URL) in your environment "
            "or provide a --env path to a .env file."
        )

    return psycopg.connect(url)
