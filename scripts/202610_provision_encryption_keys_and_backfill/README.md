# 202610 — Provision encryption keys and backfill

Creates the Cloudflare D1 database `skydiiv--production` and table
`encryption_keys`, inserts the first KEK / lookup-key version, then seals
existing listed database columns with the same envelope SkyDIIV web v2.0.0 uses
on write (including `users.email_lookup`).

Workers and web already **read** that table. They do not create it. Run this
script by hand — it is not a Worker, CRON, or QStash job.

No worker, QStash, outbox, Prisma, or Redis product-key changes.

---

## Prerequisites

| Tool | Version |
|------|---------|
| [uv](https://docs.astral.sh/uv/) | ≥ 0.4 |
| Python | ≥ 3.12 (managed by uv) |
| Cloudflare token | D1 **edit** (a dedicated operator token — not the worker query token) |
| Database | unpooled connection string for backfill |

Take a **database snapshot** of the target environment before backfill (the
scheduler already takes them).

---

## Setup

```bash
cd scripts/202610_provision_encryption_keys_and_backfill
uv sync
cp .env.example .env
# fill CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_API_TOKEN
# fill DATABASE_URL_UNPOOLED (or DATABASE_URL) before backfill
```

---

## Configuration

| Variable | Used by |
|----------|---------|
| `CLOUDFLARE_ACCOUNT_ID` | `provision`, `backfill` |
| `CLOUDFLARE_D1_API_TOKEN` | `provision`, `backfill` (D1 edit) |
| `CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID` | optional for `provision` (printed/verified); `backfill` looks up by name if unset |
| `DATABASE_URL_UNPOOLED` / `DATABASE_URL` | `backfill` |
| `D1_DATABASE_NAME` | optional, default `skydiiv--production` |

Place `.env` in this folder, in the current working directory, or pass it with
`--env`.

Do not put KEK bytes in wrangler `[vars]`, do not commit `.env`, and do not
seed D1 with the local test vectors (`32×0x11` / `32×0x22`).

---

## Usage

```bash
cd scripts/202610_provision_encryption_keys_and_backfill

# 1. preview D1 create / table / key insert (no writes)
uv run python __main__.py provision --dry-run

# 2. create or reuse D1, CREATE TABLE encryption_keys, insert version 1 if empty
uv run python __main__.py provision
```

**Mandatory pause.** Copy the printed D1 database UUID into
`CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID` on:

- SkyDIIV web env
- worker GitHub Environments `staging` and `production`

Confirm web and workers can load keys (staging first). Sealed rows fail closed
in any app that cannot load the KEK. Then:

```bash
# 3. preview database row counts (no UPDATE)
uv run python __main__.py backfill --dry-run --limit 5

# 4. sample users, then the rest
uv run python __main__.py backfill --table users --limit 20
uv run python __main__.py backfill

# point at a specific .env
uv run python __main__.py provision --env /path/to/.env
uv run python __main__.py backfill --env /path/to/.env --table users --limit 5 --dry-run
```

`--dry-run` can be combined with `--limit`, `--table`, and `--env`. Output is
written to stdout and `output.txt` (gitignored). Logs print the D1 database
UUID and row ids only. They never print `kek`, `lookup_key`, `dek`, or listed
plaintext.

`created_by` on the D1 row is
`script:202610_provision_encryption_keys_and_backfill`. Database listed tables have
no `updated_by`; this script does not invent one.

Re-running `backfill` is safe: rows with `dek` set are skipped. Do not
re-provision keys (existing `encryption_keys` rows are left unchanged).

---

## Flags

| Flag | Commands | Effect |
|------|----------|--------|
| `--dry-run` | `provision`, `backfill` | Log D1 / database actions. Do not create a D1 database, insert keys, or UPDATE database rows. |
| `--limit N` | `backfill` | Cap sealed (or would-seal) rows **per table**. |
| `--table NAME` | `backfill` | Restrict to one listed table (e.g. `users`). |
| `--env PATH` | `provision`, `backfill` | Load a specific `.env` file. |

---

## Listed tables / columns

Listed envelope columns plus `created_by` / `updated_by`. Null listed values
stay null. Empty-string `summary` is sealed. An actor value that looks like an
email is replaced with that email’s `email_lookup` HMAC (same bytes as
`users.email_lookup`; no users-table lookup) before it is sealed. Script-only;
workers keep writing their app names. Identifiers without `@` are sealed as-is.

| Table | Columns |
|-------|---------|
| `users` | `first_name`, `last_name`, `preferred_name`, `email`, `birth_date`, `profile_picture_url`, `created_by`, `updated_by` (+ `email_lookup` / `lookup_columns` / `lookup_key_version`) |
| `weekly_outfit_preferences` | `location`, `routine_description`, `created_by`, `updated_by` |
| `shopping_suggestions_preferences` | `top_size`, `bottom_size`, `foot_size`, `gender`, `created_by`, `updated_by` |
| `clothing_items` | `image_url`, `created_by`, `updated_by` |
| `feedbacks_automatic_thrifting` | `reason`, `created_by`, `updated_by` |
| `summaries_feedbacks_automatic_thrifting` | `summary` (including the empty string), `created_by`, `updated_by` |
| `llm_interactions` | `prompt`, `client_prompt`, `response`, `created_by`, `updated_by` |
| `outfits` | `image_url`, `created_by`, `updated_by` |
| `wardrobe_panorama` | `content`, `created_by`, `updated_by` |
| `tags` | `created_by`, `updated_by` |

Left plaintext: `clothing_items.title`, `outfits.title`, `tags.name`,
`outbox_events.payload`, `json_search` / `json_result` / `json_listed_product`,
`weekly_outfits.weather_summary`, `weekly_outfits.description_temperature`,
scraped-product fields, R2 objects, and `created_by` / `updated_by` on
`access_keys`, `domains`, `events`, and `outbox_events`.

Tables that still lack `dek` (`clothing_item_tags`, `clothing_item_colors`,
`outfit_tags`, `outfit_items`, `weekly_outfits`, scraped-product tables,
`app_preferences`, `user_notifications`) are a skydiiv/web follow-up. Web
should add `createdBy` / `updatedBy` to `ENCRYPTED_MODELS` so a later re-seal
does not drop actor ciphertext.

---

## Rollback

Restore the **database snapshot** taken before backfill.

Do **not** delete D1 `encryption_keys` (or the `skydiiv--production` database)
while any ciphertext remains. Dual-read on `dek IS NULL` is the compatibility
path for leftover plaintext rows. Redeploying previous worker builds is
unrelated and already dual-reads leftover plaintext.

---

## Shared utilities

| Module | Purpose |
|--------|---------|
| `scripts/utils/db.py` | Database connection via `psycopg` (no ORM) |
| `scripts/utils/logger.py` | Structured stdout / file logging |
