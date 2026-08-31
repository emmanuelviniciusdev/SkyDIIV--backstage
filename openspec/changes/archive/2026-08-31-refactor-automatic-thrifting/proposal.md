## Why

Shopping suggestions are generated as a side-effect of wardrobe panorama (trailing LLM JSON, outbox `scrape-shopping-suggestions`, CF Queues, robot writes `scraped_products` and notifies). That coupling makes weekly thrifting depend on panorama runs, hard-codes Enjoei in the prompt path, and skips the “pick the best listing” step. The product is being renamed **automatic thrifting** and needs a dedicated weekly pipeline: generate marketplace search terms, scrape listings, then analyze results before notifying the user.

## What Changes

- **BREAKING:** Stop enqueueing `scrape-shopping-suggestions` from `generate-wardrobe-panorama`. The panorama LLM no longer emits a trailing shopping-suggestions JSON block. Panorama markdown keeps the editorial “what to look for” section; it no longer drives scraping.
- **BREAKING:** Rename `apps/robot-shopping-suggestions` and all of its infra to **`robot-scrape-products`** (app folder, GHA workflows, OCI/Terraform/OCIR names, GitHub Environment secrets, `CREATED_BY`). The robot no longer drains CF Queues, no longer writes `scraped_products`, and no longer sets shopping-suggestions Redis keys. It becomes a weekly GHA-started batch job that reads unprocessed `search_terms_scraped_products` and writes `results_search_terms_scraped_products`.
- Register generate-search-terms on **Friday** `POST /schedule/every-friday`. For each existing `wardrobe_panorama` row, insert a PENDING outbox event `generate-search-terms-products-scraping` (`{ wardrobePanoramaId }`) and publish those IDs to `worker-outbox-events`.
- Add Upstash Workflow `generate-search-terms-products-scraping` on `worker-ai-workflows`: prompt from panorama + routine + gender/sizes and persist up to 10 new search-term rows (distributed across `marketplaces_catalog_scraped_products`, matching supported languages). It MUST NOT delete existing `scraped_products` or prior search/result rows.
- Add Upstash Workflow `analyze-scraped-products-results`: prompt from panorama + routine + scrape results, pick the most relevant listing per search term. Only when at least one new `scraped_products` row is ready, in one transaction: delete that panorama’s previous `scraped_products` plus related `search_terms_scraped_products` / `results_search_terms_scraped_products`, insert the new products, invalidate web Redis cache, set the unread notification. If nothing is ready to insert, last week’s rows stay.
- Robot weekly GHA moves to **Friday 19:00–21:00 BRT**. After each panorama batch it inserts outbox event `analyze-scraped-products-results` (`{ wardrobePanoramaId }`) and publishes to `worker-outbox-events`.
- `worker-outbox-events` routes both new events on broker **QStash** to the matching `worker-ai-workflows` path (payload forwarded verbatim). All automatic-thrifting events go through the outbox; no direct QStash publish to AI workflows from scheduler or robot.
- Tables `search_terms_scraped_products`, `results_search_terms_scraped_products`, and `marketplaces_catalog_scraped_products` are owned by `skydiiv/web` Prisma. This repo only reads/writes the agreed columns. Initial catalog: Enjoei, `pt-BR` only.

## Non-goals

- Do not add Prisma migrations, seed `marketplaces_catalog_scraped_products`, or change the web UI in this repo (web follow-up includes schema, seed, and outbox catalog).
- Do not add a second marketplace scraper (Enjoei remains the only registered scraper).
- Do not introduce Temporal, Prisma in workers, or a new broker besides QStash + existing Neon/Redis.
- Do not delete the `scrape-shopping-suggestions` outbox catalog row or CF Queue in this change; stop publishing new events. Catch-up of leftover PENDING scrape rows is out of scope.
- Do not change Thursday panorama eligibility (wardrobe size + update marker) or weekly-outfits.

## Capabilities

### New Capabilities

- `apps/worker-scheduler/automatic-thrifting`: Friday weekday flow that inserts one generate-search-terms outbox row per existing wardrobe panorama and publishes those IDs to worker-outbox-events.
- `apps/worker-ai-workflows/automatic-thrifting`: Search-term generation and scrape-result analysis workflows (atomic swap of `scraped_products` and related registers only when new products are ready), Redis notification/cache after analysis, and decoupling panorama from scrape enqueue.
- `apps/robot-scrape-products/automatic-thrifting`: Weekly batch scrape of unprocessed search terms into result rows, then outbox trigger of analysis per panorama.
- `apps/worker-outbox-events/automatic-thrifting`: QStash routes for `generate-search-terms-products-scraping` and `analyze-scraped-products-results` to worker-ai-workflows.

### Modified Capabilities

- (none — no existing OpenSpec capabilities cover shopping suggestions or panorama)

## Impact

- **Affected apps:** `apps/worker-scheduler`, `apps/worker-ai-workflows`, `apps/worker-outbox-events`, `apps/robot-scrape-products` (rename from `apps/robot-shopping-suggestions`).
- **skydiiv/web follow-up (required before production):** Prisma tables and columns listed in the spec (including Enjoei / `pt-BR` seed); seed outbox catalog `EVENTS` for `generate-search-terms-products-scraping` and `analyze-scraped-products-results` on broker `QStash` (backstage copies the catalog UUIDs); Redis keys stay `shopping-suggestions:{userId}` and `notification:new-shopping-suggestions:{userId}` until a later copy rename.
- **Schedule / QStash:** Existing Friday Upstash CRON already calls `/schedule/every-friday` (or add one). Robot GHA create/destroy shifts from Thursday to Friday 19:00/21:00 BRT. Order: Thursday panorama → Friday generate-search-terms → Friday 19:00 BRT robot.
- **Outbox:** Panorama stops inserting `scrape-shopping-suggestions`. Two new QStash catalog events; scheduler and robot only insert `outbox_events` + `batchJSON` `{ outboxEventId }` to `{WORKER_OUTBOX_EVENTS_URL}/process-outbox-event`. Catch-up remains the retry path.
- **Redis:** Analysis workflow (not the robot) invalidates the list cache and sets the unread flag.
- **DB:** Shared Neon. Last week’s `scraped_products` (and related search/result rows) stay until analyze has new products ready, then they are deleted in the same transaction as the insert. `scraped_products` writers move from the robot to `worker-ai-workflows`. `llm_interactions` stores both new prompts.
