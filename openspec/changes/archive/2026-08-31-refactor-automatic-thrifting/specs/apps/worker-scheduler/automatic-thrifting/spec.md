## Purpose

Friday weekday schedule on worker-scheduler that inserts one generate-search-terms outbox event per existing wardrobe panorama so automatic thrifting runs the day after panorama generation.

## ADDED Requirements

### Requirement: Friday signed schedule runs generate-search-terms dispatch

The scheduler MUST run the automatic-thrifting dispatch as a registered flow on `POST /schedule/every-friday`. The worker MUST verify the QStash `upstash-signature` header. Unsigned or invalid signatures MUST return `401` and MUST NOT query panoramas or insert outbox rows. The request body MAY be empty.

#### Scenario: Unsigned Friday request is rejected

- **GIVEN** a POST to `/schedule/every-friday` with no valid `upstash-signature`
- **WHEN** the scheduler handles the request
- **THEN** the response status is `401`
- **AND** no `outbox_events` row is inserted for `generate-search-terms-products-scraping`

#### Scenario: Signed Friday schedule with panoramas inserts one outbox row each

- **GIVEN** a valid QStash signature on `/schedule/every-friday`
- **AND** the database contains two `wardrobe_panorama` rows with ids `p1` and `p2`
- **WHEN** the Friday flows run
- **THEN** two PENDING `outbox_events` rows exist for event `generate-search-terms-products-scraping`
- **AND** each payload is `{ "wardrobePanoramaId": "<id>" }` with a distinct panorama id
- **AND** the scheduler publishes those outbox IDs to `{WORKER_OUTBOX_EVENTS_URL}/process-outbox-event` as `{ "outboxEventId": "<uuid>" }`
- **AND** the HTTP response is `200` (or `207` if another Friday flow failed) and the automatic-thrifting flow result includes dispatched count `2`

#### Scenario: Signed Friday schedule with no panoramas is a no-op

- **GIVEN** a valid QStash signature
- **AND** `wardrobe_panorama` is empty
- **WHEN** the Friday automatic-thrifting flow runs
- **THEN** it inserts zero outbox rows
- **AND** it publishes zero process-outbox-event messages
- **AND** the flow result dispatched count is `0`

### Requirement: Dispatch every existing panorama through the outbox

The flow MUST select every row in `wardrobe_panorama` (no wardrobe-size filter and no wardrobe-update-check cache marker). It MUST NOT QStash-publish directly to `worker-ai-workflows`. Outbox ID publishes to `worker-outbox-events` MUST be batched at most 100 per QStash `batchJSON` call. A failed outbox insert MUST fail the flow. A QStash publish failure after successful inserts MUST leave those rows `PENDING` (catch-up retries them).

#### Scenario: More than 100 panoramas are batched

- **GIVEN** 101 `wardrobe_panorama` rows
- **AND** a valid Friday signature
- **WHEN** the flow runs
- **THEN** 101 PENDING outbox rows exist
- **AND** QStash receives two `batchJSON` calls to `/process-outbox-event` (100 then 1)

#### Scenario: Eligibility differs from Thursday panorama

- **GIVEN** a user with a `wardrobe_panorama` row and no wardrobe-update-check marker
- **WHEN** the Friday automatic-thrifting flow runs
- **THEN** that panorama still gets a `generate-search-terms-products-scraping` outbox row
