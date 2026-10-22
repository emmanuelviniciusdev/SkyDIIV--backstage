"""Seal Neon rows whose dek is still null, using current D1 keys."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx
from psycopg.rows import dict_row

from d1 import CloudflareConfig, D1Error, load_current_keys, resolve_database
from envelope import (
    BACKFILL_TABLES,
    ENCRYPTED_MODELS,
    EncryptedModelSpec,
    rewrite_actor_values,
    seal_model_values,
)
from utils.logger import Logger

ConnectFn = Callable[..., Any]


def backfill(
    *,
    config: CloudflareConfig,
    http: httpx.Client,
    log: Logger,
    dry_run: bool,
    connect: ConnectFn,
    limit: int | None = None,
    table: str | None = None,
    env_file: str | None = None,
) -> int:
    if table is not None and table not in ENCRYPTED_MODELS:
        log.error(f"Unknown table {table}")
        return 1

    try:
        database = resolve_database(http, config)
        if database is None:
            raise D1Error(f"D1 database {config.database_name} not found")
        keys = load_current_keys(http, config, database.uuid)
    except D1Error as exc:
        log.error(f"Cannot load encryption keys: {exc}")
        return 1

    try:
        conn = connect(env_file=env_file)
    except Exception as exc:
        log.error(f"Failed to connect: {exc}")
        return 1

    tables = (table,) if table else BACKFILL_TABLES
    try:
        for name in tables:
            spec = ENCRYPTED_MODELS[name]
            try:
                ids = fetch_candidate_ids(conn, spec, limit)
            except Exception as exc:
                log.error(f"Failed to list {name} error={type(exc).__name__}")
                return 1
            log.info(f"{name} candidates={len(ids)}")
            for row_id in ids:
                if dry_run:
                    log.info(f"Would seal {name} id={row_id}")
                    continue
                try:
                    sealed = seal_row(conn, spec, row_id, keys)
                    if sealed:
                        log.info(f"Sealed {name} id={row_id}")
                    else:
                        log.info(f"Skipped {name} id={row_id}")
                except Exception as exc:
                    log.error(
                        f"Failed to seal {name} id={row_id} error={type(exc).__name__}"
                    )
                    continue
        return 0
    finally:
        conn.close()


def fetch_candidate_ids(
    conn: Any, spec: EncryptedModelSpec, limit: int | None
) -> list[str]:
    or_clause = " OR ".join(f"{column} IS NOT NULL" for column in spec.fields)
    sql = (
        f"SELECT id FROM {spec.table} "
        f"WHERE dek IS NULL AND ({or_clause}) "
        "ORDER BY id"
    )
    params: tuple[Any, ...] | None = None
    if limit is not None:
        sql += " LIMIT %s"
        params = (limit,)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return [str(row["id"]) for row in rows]


def seal_row(conn: Any, spec: EncryptedModelSpec, row_id: str, keys: Any) -> bool:
    listed = ", ".join(spec.fields)
    extra = ", email_lookup" if spec.table == "users" else ""
    select_sql = (
        f"SELECT id, {listed}, dek, kek_version, encrypted_columns, "
        f"lookup_columns{extra} "
        f"FROM {spec.table} WHERE id = %s AND dek IS NULL FOR UPDATE"
    )
    with conn.transaction():
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(select_sql, (row_id,))
            row = cur.fetchone()
            if not row:
                return False
            values = rewrite_actor_values(
                {column: row.get(column) for column in spec.fields},
                keys.lookup_key,
            )
            sealed = seal_model_values(
                table=spec.table,
                row_id=str(row["id"]),
                values=values,
                kek=keys.kek,
                kek_version=keys.kek_version,
                lookup_key=keys.lookup_key,
                lookup_key_version=keys.lookup_key_version,
            )
            if sealed is None:
                return False
            assignments = [f"{column} = %s" for column in spec.fields]
            params: list[Any] = [sealed.values.get(column) for column in spec.fields]
            assignments += ["dek = %s", "kek_version = %s", "encrypted_columns = %s"]
            params += [sealed.dek, sealed.kek_version, sealed.encrypted_columns]
            if spec.lookup:
                assignments += [
                    "lookup_key_version = %s",
                    "email_lookup = %s",
                    "lookup_columns = %s",
                ]
                params += [
                    sealed.lookup_key_version,
                    sealed.hashes.get("email_lookup"),
                    sealed.lookup_columns,
                ]
            params.append(row_id)
            cur.execute(
                f"UPDATE {spec.table} SET {', '.join(assignments)} "
                "WHERE id = %s AND dek IS NULL",
                tuple(params),
            )
            return True
