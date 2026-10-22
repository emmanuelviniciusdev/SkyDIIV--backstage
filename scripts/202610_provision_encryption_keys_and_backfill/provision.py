"""Create or reuse D1 skydiiv--production and insert encryption_keys version 1."""

from __future__ import annotations

from collections.abc import Callable

import httpx

from d1 import (
    CREATE_ENCRYPTION_KEYS_SQL,
    CloudflareConfig,
    D1Error,
    count_encryption_keys,
    create_database,
    insert_version_1_keys,
    query,
    resolve_database,
)
from envelope import encode_key, generate_key_bytes
from utils.logger import Logger

GenerateKeyFn = Callable[[], bytes]


def provision(
    *,
    config: CloudflareConfig,
    http: httpx.Client,
    log: Logger,
    dry_run: bool,
    generate_key: GenerateKeyFn = generate_key_bytes,
) -> int:
    try:
        existing = resolve_database(http, config)
    except D1Error as exc:
        log.error(f"Failed to list D1 databases: {exc}")
        return 1

    if existing is None:
        log.info(f"No D1 database named {config.database_name}")
        if dry_run:
            log.info(
                "Dry-run — would create that database, create encryption_keys, "
                "and insert version-1 keys"
            )
            return 0
        try:
            existing = create_database(http, config)
        except D1Error as exc:
            log.error(f"Failed to create D1 database: {exc}")
            return 1
        log.info(f"Created D1 database {config.database_name}")
    else:
        log.info(f"Reusing D1 database {config.database_name}")

    log.info(f"D1 database UUID: {existing.uuid}")

    if dry_run:
        log.info(
            "Dry-run — would create encryption_keys if missing and insert "
            "version-1 keys if the table is empty"
        )
        return 0

    try:
        query(http, config, existing.uuid, CREATE_ENCRYPTION_KEYS_SQL)
        n = count_encryption_keys(http, config, existing.uuid)
        if n > 0:
            log.info("encryption_keys already has rows — skipping insert")
            return 0
        kek_b64 = encode_key(generate_key())
        lookup_b64 = encode_key(generate_key())
        insert_version_1_keys(http, config, existing.uuid, kek_b64, lookup_b64)
        log.info("Inserted encryption_keys version 1")
        return 0
    except D1Error as exc:
        log.error(f"Failed to provision encryption_keys: {exc}")
        return 1
