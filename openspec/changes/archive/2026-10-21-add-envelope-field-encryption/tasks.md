## 1. worker-ai-workflows — envelope module and key store

- [x] 1.1 Port SkyDIIV web `field-encryption.ts` and `local-encryption-keys.ts` into `apps/worker-ai-workflows/src/lib/field-encryption/` (Prisma field names kept) and port web vector tests; verify unit tests round-trip AES-256-GCM, AAD `table\0column\0rowId`, wrapped DEK with no AAD, local KEK/lookup base64, and fail closed on truncated payloads
- [x] 1.2 Port web `kek-store.ts` to load `encryption_keys` over the D1 HTTP API, cache JSON rows in Redis key `encryption:database-keys` for 3600 seconds using the existing Redis helper (not product-cache helpers), and select D1 vs local keys from `DEPLOYMENT_ENVIRONMENT` (`production` / `staging` → D1; `local` or unset → local test vectors); verify unit tests cover local keys, D1 success, Redis hit/miss, unknown `kek_version` fail-closed, and missing D1 env fail-closed when the environment is production

## 2. worker-ai-workflows — decrypt on read

- [x] 2.1 Update `users`, `preferences`, `shopping-suggestions-preferences`, `wardrobe`, and `feedbacks-automatic-thrifting` repositories to SELECT `id`, `dek`, `kek_version`, and `encrypted_columns` with listed columns, decrypt when `dek` is set, and return legacy plaintext when `dek` is null; verify unit tests return plaintext for both sealed and legacy fixtures and leave `clothing_items.title` / tag names unchanged
- [x] 2.2 Update `wardrobe-panorama` `findById` and `summaries-feedbacks-automatic-thrifting` `findByUserId` to decrypt `content` / `summary` (including decrypted empty string); verify unit tests distinguish stored ciphertext from returned plaintext and treat `dek` null as legacy

## 3. worker-ai-workflows — seal on write

- [x] 3.1 Update `llm-interactions` and `wardrobe-panorama` writes to allocate the row id before `sealModelValues`, persist `dek` / `kek_version` / `encrypted_columns`, and re-seal the listed set on panorama update; verify unit tests assert INSERT/UPDATE SQL includes envelope columns, stored listed values are not plaintext, and null `client_prompt` is omitted from `encrypted_columns`
- [x] 3.2 Replace summary upsert `ON CONFLICT … SET summary = EXCLUDED.summary` and `clearStaleEmpty` `SET summary = ''` with load → seal → UPDATE that keeps the existing `outdated` / `updated_at` CAS; verify unit tests store sealed empty string, keep CAS behavior, and return decrypted summary on a later find
- [x] 3.3 Update `weekly-outfits` `updateOutfitImageUrl` to re-seal `outfits.image_url` (title stays plaintext; INSERT may still leave `dek` null while image is null); verify unit tests persist envelope columns on the image update and do not encrypt `outfits.title`

## 4. worker-ai-workflows — env, docs, quality

- [x] 4.1 Document `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID`, and `CLOUDFLARE_D1_API_TOKEN` in `.env.example` and wrangler comments; keep existing `DEPLOYMENT_ENVIRONMENT` (`production` / `staging` / `local`) as the key-source switch and do not add `ENCRYPTION_KEY_SOURCE`; add the three Cloudflare keys to both `wrangler secret bulk` lists in `.github/workflows/deploy-worker-ai-workflows.yml`
- [x] 4.2 Add `docs/FIELD_ENCRYPTION.md` (byte layout, listed columns this worker touches, D1/Redis, `DEPLOYMENT_ENVIRONMENT` → D1 vs local keys, fail-closed, dual-read) and link it from `README.md`; note sealed columns in `docs/WEEKLY_OUTFITS_WORKFLOW.md`, `docs/WARDROBE_PANORAMA_WORKFLOW.md`, `docs/GENERATE_SEARCH_TERMS_PRODUCTS_SCRAPING.md`, and `docs/ANALYZE_SCRAPED_PRODUCTS_RESULTS.md`
- [x] 4.3 Confirm existing unsigned workflow POST tests still return `401` with no DB writes; run `npm run lint` and `npm run test` in `apps/worker-ai-workflows` and verify both succeed

## 5. worker-sync

- [x] 5.1 Copy the worker-ai-workflows field-encryption module and kek-store into `apps/worker-sync/src/lib/field-encryption/` and wire Redis the same way; verify the copied vector and kek-store unit tests pass in this app
- [x] 5.2 Seal/open `wardrobe_panorama.content` and `llm_interactions.prompt` / `response` in the sync repositories; leave `weekly_outfits.weather_summary` / `description_temperature` plaintext; verify unit tests decrypt legacy and sealed panoramas, persist ciphertext on content/LLM writes, and do not add `dek` to weekly-outfit updates
- [x] 5.3 Mirror env, wrangler `[vars]`, and secret-bulk keys from task 4.1 in worker-sync `.env.example`, `wrangler.toml`, and `.github/workflows/deploy-worker-sync.yml`; add `docs/FIELD_ENCRYPTION.md` plus README link and a sealed-column note in `docs/SYNC_LANGUAGE_WORKFLOW.md`; confirm unsigned `POST /sync/language` still returns `401`; run `npm run lint` and `npm run test` in `apps/worker-sync` and verify both succeed

## 6. worker-scheduler

- [x] 6.1 Change `findUsersWithOutfitPreferences` to the dual filter from design.md (legacy empty-string check when `dek` is null; sealed rows qualify only when `encrypted_columns` contains both `location` and `routine_description`); verify unit tests include a sealed complete row, exclude a sealed row missing `routine_description`, exclude legacy `location = ''`, and still assert the query does not decrypt
- [x] 6.2 Update `README.md` weekly-outfits eligibility bullet to describe the `dek` / `encrypted_columns` filter (unset location/routine stored as NULL, not empty string, after encryption); confirm unsigned `POST /schedule/every-sunday` still returns `401` and publishes no generate-weekly-outfits messages; run `npm run lint` and `npm run test` in `apps/worker-scheduler` and verify both succeed
