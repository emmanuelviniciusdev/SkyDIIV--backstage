## 1. Script package

- [x] 1.1 Create `scripts/202610_provision_encryption_keys_and_backfill/` with `pyproject.toml` (Python ≥ 3.12, `psycopg[binary]`, `python-dotenv`, `cryptography`, `httpx`, `pytest`), `.env.example` (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_API_TOKEN`, optional `CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID`, `DATABASE_URL_UNPOOLED` / `DATABASE_URL`, optional `D1_DATABASE_NAME=skydiiv--production`), empty `__main__.py`, and `tests/`, then verify `uv sync` succeeds in that folder
- [x] 1.2 Write `README.md` covering `provision` and `backfill` subcommands, `--dry-run`, `--limit`, `--table`, `--env`, the mandatory pause to set `CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID` on web and worker GitHub Environments after provision, listed tables/columns, no logging of key material, and Neon snapshot rollback (do not delete D1 keys while ciphertext exists), then verify those flags and the rollback note are documented

## 2. Envelope crypto

- [x] 2.1 Port web `sealModelValues` into the script (AES-256-GCM, per-row DEK, standard base64 of 12-byte nonce || ciphertext || 16-byte tag, field AAD `table\0column\0rowId`, DEK wrap with no AAD, email trim/lowercase, birth date `YYYY-MM-DD`, `email_lookup` HMAC-SHA256) for the v2.0.0 listed models, then verify pytest: round-trip plaintext, packed layout, deterministic lookup hash for `Ada@Example.com`, empty-string `summary` is listed, all-null listed values leave no envelope, and `clothing_items.title` / `outfits.title` / `tags.name` are not in the model map

## 3. D1 provision

- [x] 3.1 Implement `provision`: list/create D1 database `skydiiv--production` via the Cloudflare HTTP API, `CREATE TABLE IF NOT EXISTS encryption_keys` matching web `scripts/database-encryption-keys.sql`, generate 32-byte KEK and lookup key (not local test vectors) and INSERT version 1 only when the table is empty, print the database UUID, and skip insert when rows exist, then verify unit tests with a mocked HTTP client: create-when-missing, reuse-existing, dry-run issues no POST create/query writes, empty-table insert of version 1, existing-row skip, and logs contain the UUID but not kek/lookup base64

## 4. Neon backfill

- [x] 4.1 Implement `backfill`: load current keys from D1 (abort non-zero with no Neon writes when the table is empty), select `dek IS NULL` rows with at least one non-null listed column, `SELECT … FOR UPDATE` then `UPDATE … WHERE dek IS NULL` per row, set `email_lookup` / `lookup_columns` for users, skip already-sealed and all-null-listed rows (outfit title-only), continue after per-row failures, honor `--dry-run` / `--limit` / `--table`, then verify unit tests with mocked D1 and Neon: dry-run issues no UPDATE; user email and names become ciphertext plus `email_lookup`; empty summary is sealed; title-only outfit is skipped; `dek` set rows are unchanged; missing keys exit before any UPDATE; one failing user does not block the next

## 5. Worker docs pointer

- [x] 5.1 Add a short operator note to `apps/worker-ai-workflows/docs/FIELD_ENCRYPTION.md` and `apps/worker-sync/docs/FIELD_ENCRYPTION.md` linking the provision/backfill script as the way `encryption_keys` is created, then verify both docs name `scripts/202610_provision_encryption_keys_and_backfill/` and still describe D1 read + Redis cache as the runtime path

## 6. Verification

- [x] 6.1 Run `uv run pytest` in `scripts/202610_provision_encryption_keys_and_backfill` and verify envelope, provision, and backfill tests pass

## 7. Actor columns

- [x] 7.1 Add `created_by` / `updated_by` to the script model map for every envelope table plus `tags`, keep `access_keys` / `domains` / `events` / `outbox_events` out of the map, replace an actor email with that email’s `email_lookup` HMAC before seal (no users-table lookup), and verify pytest: decrypted actor equals `email_lookup` for `Ada@Example.com`, service identifier unchanged, tag `name` stays plaintext, excluded tables are absent
- [x] 7.2 Add the same actor fields to worker `ENCRYPTED_MODELS` (including `Tag`) and pass them through listed inserts/updates so a re-seal keeps actor ciphertext; workers still write their app names (`worker-ai-workflows`, `worker-sync`); verify field-encryption and repository unit tests
- [x] 7.3 Update the script README and both `FIELD_ENCRYPTION.md` files with actor columns, the script-only email → `email_lookup` HMAC rewrite, and that workers keep storing app names

skydiiv/web follow-up: add `createdBy` / `updatedBy` to web `ENCRYPTED_MODELS` so a re-seal does not drop actor ciphertext, and add envelope columns on tables that still lack `dek` if those actor columns should be sealed. No outbox or Redis product-key follow-up.
