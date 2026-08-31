## Purpose

Outbox routes that deliver automatic-thrifting workflow payloads from PENDING `outbox_events` rows to worker-ai-workflows over QStash, without Cloudflare Queues.

## ADDED Requirements

### Requirement: Route generate-search-terms through QStash

When `worker-outbox-events` processes an outbox row whose catalog pair is `generate-search-terms-products-scraping` + `QStash`, it MUST publish the stored payload verbatim to `{WORKER_AI_WORKFLOWS_URL}/generate-search-terms-products-scraping`. `WORKER_AI_WORKFLOWS_URL` MUST be the worker origin (no path). Unknown catalog pairs MUST still fail as today.

#### Scenario: Generate-search-terms outbox reaches the AI workflow

- **GIVEN** a PENDING outbox row with event `generate-search-terms-products-scraping`, broker `QStash`, and payload `{ "wardrobePanoramaId": "p1" }`
- **WHEN** `POST /process-outbox-event` runs for that row
- **THEN** QStash publishes that JSON body to `{WORKER_AI_WORKFLOWS_URL}/generate-search-terms-products-scraping`
- **AND** the row is marked `SUCCESS` after a successful publish

### Requirement: Route analyze-scraped-products-results through QStash

When the catalog pair is `analyze-scraped-products-results` + `QStash`, the worker MUST publish the stored payload verbatim to `{WORKER_AI_WORKFLOWS_URL}/analyze-scraped-products-results`.

#### Scenario: Analyze outbox reaches the AI workflow

- **GIVEN** a PENDING outbox row with event `analyze-scraped-products-results`, broker `QStash`, and payload `{ "wardrobePanoramaId": "p1" }`
- **WHEN** `POST /process-outbox-event` runs for that row
- **THEN** QStash publishes that JSON body to `{WORKER_AI_WORKFLOWS_URL}/analyze-scraped-products-results`
- **AND** the row is marked `SUCCESS` after a successful publish

### Requirement: Scrape-shopping-suggestions is not used for new automatic thrifting

New automatic-thrifting traffic MUST NOT use the `scrape-shopping-suggestions` + `CF Queues` route. That route MAY remain in `OUTBOX_ROUTES` for leftover catalog rows.

#### Scenario: New generate event is not sent to CF Queues

- **GIVEN** an outbox row for `generate-search-terms-products-scraping` on `QStash`
- **WHEN** dispatch runs
- **THEN** Cloudflare Queues `messages/batch` is not called for that row
