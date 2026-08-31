## 1. skydiiv/web follow-up (do not implement in this repo)

- [x] 1.1 Add Prisma models/migrations for `marketplaces_catalog_scraped_products`, `search_terms_scraped_products`, and `results_search_terms_scraped_products` with the columns in design.md (jsonb `json_search` / `json_result`, `is_processed` default false, audit columns, FKs so results can be deleted with terms) and verify `prisma migrate` applies on a web-repo database
- [x] 1.2 Seed `marketplaces_catalog_scraped_products` with `name = enjoei` and `supported_languages` including `pt-BR`, then verify the row is readable from Neon
- [x] 1.3 Seed outbox catalog `EVENTS` for `generate-search-terms-products-scraping` and `analyze-scraped-products-results` on broker `QStash`, then verify the UUIDs are available to copy into backstage repositories
- [x] 1.4 Confirm web still reads `scraped_products` plus Redis keys `shopping-suggestions:{userId}` and `notification:new-shopping-suggestions:{userId}`. Do not implement this in skydiiv--backstage

## 2. worker-ai-workflows — decouple panorama

- [x] 2.1 Remove the trailing shopping-suggestions JSON instructions from the panorama prompt and parse markdown-only LLM output, then verify panorama prompt/unit tests pass without a JSON fence
- [x] 2.2 Remove the `enqueue-shopping-suggestions` workflow step and shopping-prefs load used only for scrape enqueue, then verify generate-wardrobe-panorama tests no longer insert `scrape-shopping-suggestions` outbox rows

## 3. worker-ai-workflows — generate search terms

- [x] 3.1 Add postgres.js repositories for wardrobe panorama by id, marketplace catalog, exists-unprocessed search terms, and inserting `search_terms_scraped_products` (no deletes of products/terms/results), then verify unit tests cover SQL shape and skip-when-unprocessed
- [x] 3.2 Add Zod payload `{ wardrobePanoramaId }`, `json_search` schema (`term`, `gender`, `topSize`, `bottomSize`, `footSize`), LLM output parse (term + sizeCategory, cap 10), locale/catalog eligibility, and round-robin marketplace assignment, then verify unit tests for pt-BR/enjoei, ineligible locale (zero inserts, existing `scraped_products` unchanged), and the cap
- [x] 3.3 Add prompt builder (panorama markdown + routine + gender/sizes) and `createWorkflow` `generate-search-terms-products-scraping` steps (validate → skip if unprocessed → load → prompt → LLM/`llm_interactions` → insert), then verify integration tests: missing id fails with no writes; success inserts ≤10 `is_processed=false` rows without deleting `scraped_products`
- [x] 3.4 Register the workflow key in `serveMany` `workflowRegistry` and verify a request to `/generate-search-terms-products-scraping` is routed (unsigned → 401 in existing worker tests)

## 4. worker-ai-workflows — analyze scraped results

- [x] 4.1 Add a repository that, in one transaction for a panorama, deletes existing `scraped_products`, inserts the chosen listings (clothing-item `product_type` domain), then deletes related `results_search_terms_scraped_products` and `search_terms_scraped_products`, then verify unit tests: swap only runs when the new row list is non-empty; empty list performs no deletes; other panoramas are untouched
- [x] 4.2 Add shopping-suggestions Redis helpers (`DEL shopping-suggestions:{userId}`, `SET notification:new-shopping-suggestions:{userId}` with `{ updatedAt }`) and verify unit tests match those exact keys; Redis errors are logged and do not throw after a successful swap
- [x] 4.3 Add analyze prompt + Zod (one chosen result id per search term) and `createWorkflow` `analyze-scraped-products-results` (validate → load unprocessed results → empty skip without deletes → LLM → swap if any listings → cache), then verify integration tests: empty/zero selection keeps last week’s products and skips notify; success replaces `scraped_products` and removes related search/result rows; missing id fails without deletes
- [x] 4.4 Register `analyze-scraped-products-results` in `workflowRegistry` and verify unsigned POST → 401

## 5. worker-ai-workflows — quality

- [x] 5.1 Run `npm run lint` and `npm run test` in `apps/worker-ai-workflows` and verify both succeed

## 6. worker-outbox-events

- [x] 6.1 Add `OUTBOX_ROUTES` + `dispatch` cases for `generate-search-terms-products-scraping` and `analyze-scraped-products-results` on `QStash` to `{WORKER_AI_WORKFLOWS_URL}/<workflow-key>` (origin-only URL helper), then verify dispatcher unit tests publish the stored payload to those paths and do not call CF Queues
- [x] 6.2 Document `WORKER_AI_WORKFLOWS_URL` in the outbox worker README/env and verify the origin-only rule is stated
- [x] 6.3 Run `npm run lint` and `npm run test` in `apps/worker-outbox-events` and verify both succeed

## 7. worker-scheduler

- [x] 7.1 Add a panorama-ids repository (`SELECT id FROM wardrobe_panorama`) and outbox insert for `generate-search-terms-products-scraping` using the web catalog UUID, then verify unit tests for empty/non-empty id lists and payload `{ wardrobePanoramaId }`
- [x] 7.2 Implement the Friday flow (insert PENDING rows, `batchJSON` `{ outboxEventId }` to `{WORKER_OUTBOX_EVENTS_URL}/process-outbox-event` in batches of 100) and register it on `friday`, then verify tests: unsigned `/schedule/every-friday` → 401; two panoramas → two outbox rows + two publishes; zero panoramas → dispatched 0; 101 ids → two QStash batches; QStash failure after insert leaves PENDING
- [x] 7.3 Document Friday automatic thrifting and ordering (after Thursday panorama, before Friday 19:00 BRT robot) in `apps/worker-scheduler/README.md`, then verify the weekday table lists the flow
- [x] 7.4 Run `npm run lint` and `npm run test` in `apps/worker-scheduler` and verify both succeed

## 8. robot-scrape-products (rename + batch scrape)

- [x] 8.1 Rename `apps/robot-shopping-suggestions` to `apps/robot-scrape-products` and update GHA (`weekly-`, `cost-guard-`, `deploy-`), Terraform/OCI/OCIR names, GitHub secret `ROBOT_SCRAPE_PRODUCTS_ENV`, package `name`, and `CREATED_BY`, then verify grep in the repo no longer requires the old app path for these artifacts
- [x] 8.2 Change `EnjoeiScraper` from the first `.c-product-card` to up to 10 listings per search (same URL, ranking, delay, proxy), then verify unit/integration scraper tests return multiple cards and cap at 10
- [x] 8.3 Add repositories for unprocessed search terms grouped by panorama and for inserting `results_search_terms_scraped_products` + marking terms processed; map `json_search.term` → `searchTerm` for Enjoei, then verify unit tests for grouping, cap 10, empty scrape still sets `is_processed=true`, and unknown marketplace marks processed with no result rows
- [x] 8.4 Implement the batch runner (no CF Queues pull): process panoramas, scrape, persist `json_result`, insert `analyze-scraped-products-results` outbox + publish `{ outboxEventId }` to worker-outbox-events once per panorama, then self-delete; verify integration tests cover two panoramas → two outbox rows, skip processed terms, and no `scraped_products` writes
- [x] 8.5 Wire `main.ts`: drop required CF Queue env; require `QSTASH_TOKEN` and origin-only `WORKER_OUTBOX_EVENTS_URL`; make web Redis optional/unused; shift weekly GHA cron to Friday 19:00/21:00 BRT; update `.env.example` and docs, then verify `loadConfig` tests accept the new required vars and boot without CF Queue ids
- [x] 8.6 Run `npm run lint` and `npm run test` in `apps/robot-scrape-products` and verify both succeed
