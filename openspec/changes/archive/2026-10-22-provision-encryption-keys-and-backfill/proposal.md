## Why

SkyDIIV web v2.0.0 and the backstage workers already seal listed database columns with envelope AES-256-GCM, but they only *read* keys from Cloudflare D1 and they dual-read `dek IS NULL` as plaintext. Existing rows are still plaintext, the key database may not exist yet, and `users.email_lookup` is empty — so production has no first KEK/lookup version and uniqueness/login lookups that depend on the HMAC are not populated.

## What Changes

- Add a one-off Python script under `scripts/202610_provision_encryption_keys_and_backfill/` that operators run in two steps:
  - **Provision:** create the Cloudflare D1 database `skydiiv--production` if it is missing, create table `encryption_keys` (same shape as web `scripts/database-encryption-keys.sql`), generate cryptographically random 32-byte KEK and lookup key, and insert them as version `1` when the table is empty.
  - **Backfill:** encrypt every existing database row that has `dek` null and at least one non-null listed column, using the web v2.0.0 envelope (`sealModelValues` semantics, including `users.email_lookup` / `lookup_columns`). Also rewrite `created_by` / `updated_by` from a stored email to that email’s `email_lookup` HMAC (same bytes as `users.email_lookup`, no users-table lookup) and seal those actor columns on every envelope table, including `tags`. Worker/script identifiers without `@` stay as-is. Leave `access_keys`, `domains`, `events`, and `outbox_events` actor columns plaintext.
- Support `--dry-run` so operators can preview D1 actions and per-table row counts without creating databases, inserting keys, or writing database rows.
- Print the D1 database UUID after provision so operators can set `CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID` on web and workers *before* backfill.
- Worker listed writes still store the existing app name (`worker-ai-workflows`, `worker-sync`, …). `ENCRYPTED_MODELS` includes `created_by` / `updated_by` only so a later re-seal does not drop actor ciphertext. No QStash, outbox, schedule, Prisma, or Redis product-key changes. The email → `email_lookup` rewrite is script-only.

**BREAKING** (database at rest only): after backfill, listed columns that currently hold plaintext become ciphertext and `users.email` uniqueness is enforced via `email_lookup`. HTTP paths, QStash payloads, and worker contracts do not change. Dual-read on `dek IS NULL` remains for any leftover plaintext rows.

## Non-goals

- Do not rotate keys, insert a second KEK version, or re-seal rows that already have `dek` set.
- Do not encrypt columns web left plaintext: `clothing_items.title`, `outfits.title`, `tags.name`, `outbox_events.payload`, `json_search` / `json_result` / `json_listed_product`, `weekly_outfits.weather_summary`, `weekly_outfits.description_temperature`, scraped-product fields, or R2 objects.
- Do not encrypt `created_by` / `updated_by` on `access_keys`, `domains`, `events`, or `outbox_events`.
- Do not add `dek` columns from this repo. Actor encryption on tables that lack envelope columns (`clothing_item_tags`, `clothing_item_colors`, `outfit_tags`, `outfit_items`, `weekly_outfits`, scraped-product tables, `app_preferences`, `user_notifications`) is a skydiiv/web follow-up.
- Do not change Prisma schema, outbox catalog, or Redis product-cache keys.
- Do not commit key material, put KEK bytes in wrangler `[vars]`, or seed D1 with the local test vectors (`32×0x11` / `32×0x22`).
- Do not run as a Worker, CRON, or QStash job. This is a manually run script.
- Do not add a `packages/` workspace or import worker TypeScript from the script.

## Capabilities

### New Capabilities

- `scripts/provision-encryption-keys-and-backfill`: Operator-run script that provisions Cloudflare D1 `skydiiv--production` + `encryption_keys`, inserts the first KEK/lookup version, and seals existing listed database columns (including `users.email_lookup`) with the web v2.0.0 envelope.

### Modified Capabilities

- (none)

## Impact

- **Affected area:** one-off script under `scripts/` plus worker `ENCRYPTED_MODELS` / listed writes so actor columns stay in the envelope. README pointer in existing `docs/FIELD_ENCRYPTION.md` files.
- **skydiiv/web follow-up:** add `createdBy` / `updatedBy` to web `ENCRYPTED_MODELS` so a web re-seal does not drop actor ciphertext; add envelope columns on tables that still lack `dek` if those actor columns should be sealed. Operators must set `CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID` on web and on worker GitHub Environments after provision, before backfill.
- **Database:** D1 `skydiiv--production` table `encryption_keys` (insert version 1). Database UPDATE of listed columns plus `dek`, `kek_version`, `encrypted_columns`, and for users `email_lookup` / `lookup_columns`. No schema migrations from this repo.
- **Schedule / QStash / outbox:** none.
- **Redis:** none required. Key cache `encryption:database-keys` fills on the next worker/web load after keys exist.
