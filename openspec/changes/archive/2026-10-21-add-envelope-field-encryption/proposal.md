## Why

SkyDIIV web v2.0.0 now stores listed columns as envelope AES-256-GCM ciphertext in the shared Neon database. Backstage workers still read and write those columns as plaintext, so they will feed ciphertext into LLMs and geocoding, overwrite sealed rows with plaintext, and dispatch weekly-outfit jobs on empty-string ciphertext. The envelope must land in the workers that own those rows before (or with) encrypted web writes.

## What Changes

- Port the web byte layout (`field-encryption.ts` / `kek-store.ts`) into the workers that touch sealed columns. Application code and QStash payloads stay plaintext; repositories encrypt on write and decrypt on read.
- On every write of a listed column, persist `dek`, `kek_version`, `encrypted_columns`, and (for users) `email_lookup` / `lookup_columns` using the same D1 key table and Redis cache key as web.
- Dual-read legacy rows (`dek` IS NULL) as plaintext. The next successful write of that row seals every non-null listed column.
- Change weekly-outfit eligibility SQL so it does not treat ciphertext as a non-empty opt-in string.
- Load KEK / lookup keys from Cloudflare D1 (`encryption_keys`) with the same 1-hour Redis cache when the worker environment is production (or staging). Use web’s local test vectors for local development and tests. There is no `ENCRYPTION_KEY_SOURCE` switch.
- Document the env/secrets and at-rest contract in the affected apps’ README and docs.

**BREAKING** (database at rest only): listed columns written by backstage become ciphertext. HTTP paths, QStash signatures, workflow payloads, and unsigned `GET /` / `401` contracts do not change.

## Non-goals

- Do not add a pnpm workspace or shared `packages/` library; apps stay independent Node 22 projects with the encryption module copied per app (same pattern as observability).
- Do not change Prisma schema, outbox catalog, or Redis product-cache keys. Schema and `encryption_keys` already live in skydiiv/web.
- Do not encrypt columns web left plaintext: `clothing_items.title`, `outfits.title`, `tags.name`, `outbox_events.payload`, `json_search` / `json_result` / `json_listed_product`, `weekly_outfits.weather_summary`, scraped-product fields.
- Do not change `worker-notification`, `worker-outbox-events`, or `robot-scrape-products` (they do not read or write sealed columns).
- Do not implement key creation, key rotation, a plaintext backfill, Python script decrypt helpers, or encrypt R2 objects.
- Do not add Prisma to workers, skip QStash verification, or change schedules / outbox routes / workflow keys.

## Capabilities

### New Capabilities

- `apps/worker-ai-workflows/field-encryption`: Envelope encrypt/decrypt at the repository boundary for every sealed column this worker reads or writes, using the web v2.0.0 byte layout and D1/Redis key store.
- `apps/worker-scheduler/field-encryption`: Weekly-outfit eligibility that remains correct when `location` / `routine_description` are ciphertext, without decrypting those rows in the scheduler.
- `apps/worker-sync/field-encryption`: Envelope encrypt/decrypt for `wardrobe_panorama.content` and `llm_interactions.prompt` / `response` so language sync still translates plaintext and writes ciphertext.

### Modified Capabilities

- `apps/worker-ai-workflows/automatic-thrifting`: Search-term, analyze, and panorama flows MUST load listed inputs as plaintext (after decrypt) and MUST persist listed outputs as ciphertext (after seal). Application-visible summary / panorama / prompt text is unchanged.

## Impact

- **Affected apps:** `apps/worker-ai-workflows`, `apps/worker-scheduler`, `apps/worker-sync`.
- **skydiiv/web follow-up:** none for Prisma, outbox catalog, or Redis product keys. Backstage MUST reuse web’s D1 table, Redis key `encryption:database-keys` (1-hour TTL), and local key material. Operators already provision `encryption_keys`; this repo only reads it.
- **Schedule / QStash / outbox:** no new events, routes, workflow keys, or signature changes. Unsigned POSTs still `401`. Sunday weekly-outfit dispatch still uses the same outbox path; only the eligibility query changes so sealed empty strings are not treated as opted-in.
- **Env:** new secrets `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID`, `CLOUDFLARE_D1_API_TOKEN`. Key source is inferred from existing `DEPLOYMENT_ENVIRONMENT` (`production` / `staging` → D1; `local` or unset → local test vectors). Staging and production GitHub Environments need the D1 secrets. Redis bindings already exist on the three apps.
- **Dependencies:** Node `crypto` only (already enabled via `nodejs_compat`). No new npm crypto library.
- **Docs:** each affected app README plus a new `docs/FIELD_ENCRYPTION.md`. Scheduler weekday docs that describe outfit-preference eligibility MUST mention the ciphertext-safe filter.
