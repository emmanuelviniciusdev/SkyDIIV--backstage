## Why

Friday search-term generation still ignores like/dislike history, so Enjoei queries repeat tastes the owner already rejected. Web now stores durable feedback snapshots and a per-account summary row (`summaries_feedbacks_automatic_thrifting`) with an `outdated` flag, but backstage never writes that summary or feeds it into generate-search-terms.

## What Changes

- Before `generate-search-terms-products-scraping` calls the search-term LLM, resolve a feedback summary for the panorama owner and inject it into the prompt when one is available. The summary is **taste context**, not a quota: generated terms MUST stay varied (panorama gaps, types, colors, styles). A strong like (for example many likes on black shirts) MUST NOT cause a batch of only that kind of term.
- If the owner has no `feedbacks_automatic_thrifting` rows, skip summarization and generate terms as today (panorama, routine, gender/sizes only).
- If feedbacks exist: create the summary row when missing; refresh it when `outdated = true`; reuse it when `outdated = false`.
- Consider at most the **250 most recent** feedback rows (env `FEEDBACK_SUMMARY_MAX_ENTRIES`, default 250). Before any LLM call, run each row through a **marketplace factory** so the model never sees raw `json_search` / `json_result` / `json_listed_product`. Each marketplace has its own factory; **Enjoei is the only one in this change**. Fold those factory records in chunks (env `FEEDBACK_SUMMARY_CHUNK_SIZE`, default **50**), passing the previous summary into each later call.
- Persist each summarizer call in `llm_interactions`. After a successful refresh, write `summary` and clear `outdated` only when no newer web write raced the job.
- Enjoei scraping stays unchanged: `robot-scrape-products` still reads `search_terms_scraped_products`. Better terms are the only coupling.

### Non-goals

- Do not add a second marketplace factory (Enjoei only).
- Do not change Enjoei URL building, size confirmation, or any `robot-scrape-products` scraper behavior.
- Do not change analyze-scraped-products-results, panorama, weekly-outfits, scheduler Friday dispatch, or outbox routes.
- Do not add a new HTTP endpoint, outbox event, or QStash catalog row (web already decided feedback writes do not publish events).
- Do not add Prisma migrations in this repo; tables already live in skydiiv/web.
- Do not show the summary in the web UI (web non-goal).
- Do not cache summaries in Redis.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `apps/worker-ai-workflows/automatic-thrifting`: Generate-search-terms must consult (and lazily create/refresh) the owner's feedback summary before producing marketplace terms; skip when there are no feedbacks; factory rows per marketplace (Enjoei first); cap the LLM window at the 250 most recent; use the summary as a steer that preserves term variety.

## Impact

- **Affected apps:** `apps/worker-ai-workflows` only (`generate-search-terms-products-scraping` workflow, prompt builder, Enjoei feedback factory, new repositories, env vars).
- **skydiiv/web:** No follow-up. Tables `feedbacks_automatic_thrifting` and `summaries_feedbacks_automatic_thrifting` already exist; web only sets `outdated = true` on an existing summary row.
- **Schedule / QStash / outbox:** Unchanged. Same Friday generate-search-terms outbox payload `{ wardrobePanoramaId }`. Unsigned workflow POSTs still return `401`.
- **Redis:** Unchanged.
- **DB:** Read feedbacks; insert/update one summary row per user; extra `llm_interactions` rows for summarizer calls. Search-term insert cap (10) and Enjoei catalog behavior stay the same.
