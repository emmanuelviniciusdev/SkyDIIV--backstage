# apps/worker-ai-workflows/automatic-thrifting Specification

## Purpose

Durable AI workflows that turn a wardrobe panorama into marketplace search terms, then pick the best scraped listings and notify the user, without coupling those steps to panorama generation.

## Requirements

### Requirement: Generate search terms workflow endpoint

`worker-ai-workflows` MUST host an Upstash Workflow at `POST /generate-search-terms-products-scraping` (workflow key `generate-search-terms-products-scraping`; the key MUST NOT contain `/`). The payload MUST be `{ "wardrobePanoramaId": "<uuid>" }` as stored on the outbox row (forwarded by worker-outbox-events). A missing or empty `wardrobePanoramaId` MUST fail the workflow without inserting `search_terms_scraped_products`. Unsigned requests that are not valid Upstash Workflow/QStash callbacks MUST return `401`.

#### Scenario: Valid payload starts generation

- **GIVEN** a signed request whose body includes a `wardrobePanoramaId` that exists in `wardrobe_panorama`
- **WHEN** `POST /generate-search-terms-products-scraping` is invoked
- **THEN** the workflow runs and, on success, inserts at most 10 `search_terms_scraped_products` rows for that panorama

#### Scenario: Missing panorama id fails without writes

- **GIVEN** a signed request whose payload omits `wardrobePanoramaId` or sets it to an empty string
- **WHEN** the workflow starts
- **THEN** it fails
- **AND** no `search_terms_scraped_products` row is inserted
- **AND** existing thrifting rows for other panoramas are left unchanged

#### Scenario: Unsigned request is rejected

- **GIVEN** a POST to `/generate-search-terms-products-scraping` without a valid QStash/Workflow signature
- **WHEN** the worker handles the request
- **THEN** the response status is `401`

### Requirement: Generate must not delete live products or prior registers

The generate-search-terms workflow MUST NOT delete `scraped_products`, `search_terms_scraped_products`, or `results_search_terms_scraped_products`. If the panorama already has at least one search-term row with `is_processed = false`, it MUST NOT insert additional rows.

#### Scenario: Last week’s products stay visible during term generation

- **GIVEN** panorama `p1` already has `scraped_products` and processed search-term/result rows
- **WHEN** generate-search-terms succeeds for `p1`
- **THEN** those existing `scraped_products` rows still exist
- **AND** new unprocessed `search_terms_scraped_products` rows are inserted for `p1`

#### Scenario: Unprocessed terms block a second generate

- **GIVEN** panorama `p1` already has unprocessed `search_terms_scraped_products` rows
- **WHEN** generate-search-terms runs again for `p1`
- **THEN** no new search-term rows are inserted
- **AND** `scraped_products` is unchanged

### Requirement: Search-term prompt inputs and persistence

The generate-search-terms workflow MUST load the panorama markdown, the owner's routine description (`weekly_outfit_preferences.routine_description` when present), and gender/size preferences (`shopping_suggestions_preferences`). When a non-empty feedback summary is available for that owner, the search-term LLM prompt MUST include that summary as taste context and MUST instruct the model to keep a **varied** set of terms (different types, colors, and styles drawn from the panorama, not a single repeated like). The summary MUST bias away from disliked patterns and MAY lean into liked ones, but it MUST NOT be treated as an exclusive filter — for example, many likes on black shirts MUST NOT produce only black-shirt terms. When no summary is available, the prompt MUST omit it and MUST still generate terms from panorama, routine, and preferences as today. It MUST call the configured LLM and persist a successful call in `llm_interactions`. It MUST insert at most 10 rows into `search_terms_scraped_products` with:

- `wardrobe_panorama_id` set to the payload id
- `llm_interaction_id` set to the audit row
- `marketplace` set to a catalog marketplace `name`
- `json_search` containing at least `term` (non-empty string), `gender` (string or null), and size fields `topSize`, `bottomSize`, `footSize` (each string or null)
- `is_processed` defaulting to `false`
- `created_*` / `updated_*` populated

The workflow MUST NOT set Redis notification keys. Existing `scraped_products` for that panorama MUST remain until analyze swaps them.

#### Scenario: Terms persisted from panorama and preferences

- **GIVEN** panorama `p1` for a user with routine text and gender `Female`, top size `M`
- **AND** the LLM returns 8 valid search terms
- **WHEN** the workflow completes successfully
- **THEN** 8 new unprocessed rows exist in `search_terms_scraped_products` for `p1`
- **AND** each new `json_search.term` is non-empty
- **AND** `llm_interaction_id` is non-null
- **AND** any pre-existing `scraped_products` for `p1` still exist

#### Scenario: Missing shopping preferences still generate terms

- **GIVEN** panorama `p1` whose owner has no `shopping_suggestions_preferences` row
- **WHEN** the workflow completes successfully with LLM terms
- **THEN** rows are inserted with `json_search.gender` and size fields null
- **AND** `json_search.term` is still present

#### Scenario: Feedback summary is included when available

- **GIVEN** panorama `p1` whose owner has a non-empty `summaries_feedbacks_automatic_thrifting.summary`
- **WHEN** the workflow builds the search-term prompt
- **THEN** that prompt contains the summary text
- **AND** it still contains panorama, routine, and purchase-preference context
- **AND** it instructs the model to keep variety and not restrict terms to the most frequent liked item

#### Scenario: Terms generate without summary when none is available

- **GIVEN** panorama `p1` whose owner has no feedbacks (or an empty summary after resolution)
- **WHEN** the workflow completes successfully with LLM terms
- **THEN** unprocessed `search_terms_scraped_products` rows are still inserted for `p1`
- **AND** the search-term prompt does not include a feedback-summary section

### Requirement: Resolve feedback summary before generating search terms

After the generate-search-terms workflow has decided it will produce new terms (no unprocessed search-term rows for that panorama, and at least one eligible marketplace), it MUST resolve a feedback summary for the panorama owner before calling the search-term LLM. Resolution MUST use `feedbacks_automatic_thrifting` and at most one `summaries_feedbacks_automatic_thrifting` row for that `user_id`:

- If the owner has zero feedback rows, the workflow MUST skip summarizer LLM calls, MUST NOT create a summary row, MUST generate search terms without feedback-summary context, and MUST leave an existing summary row untouched except that if that row is `outdated = true` it MUST set `summary` to empty and `outdated` to false so a later run does not keep refreshing against an empty set.
- If feedbacks exist and no summary row exists, the workflow MUST create one from the factory records of at most the 250 most recent feedbacks (chunked LLM) and persist `outdated = false`.
- If feedbacks exist and the summary row has `outdated = true`, the workflow MUST regenerate the summary from the factory records of at most the 250 most recent feedbacks (chunked LLM) and persist the new text.
- If feedbacks exist and the summary row has `outdated = false`, the workflow MUST reuse the stored `summary` and MUST NOT call the summarizer LLM.

The workflow MUST NOT insert a second summary row for the same user. Unsigned `POST /generate-search-terms-products-scraping` MUST still return `401` and MUST NOT write summary or search-term rows. If unprocessed search-term rows already exist, the workflow MUST skip both summarization and insert (same as today).

A required summarizer LLM failure (create or refresh path) MUST fail the workflow without inserting `search_terms_scraped_products`.

#### Scenario: No feedbacks skips summarization

- **GIVEN** panorama `p1` whose owner has no `feedbacks_automatic_thrifting` rows
- **AND** no unprocessed search-term rows
- **AND** at least one eligible marketplace
- **WHEN** generate-search-terms runs
- **THEN** no summarizer LLM call is made
- **AND** no `summaries_feedbacks_automatic_thrifting` row is inserted
- **AND** search-term rows are still inserted without feedback-summary context

#### Scenario: Missing summary is created from feedbacks

- **GIVEN** panorama `p1` whose owner has one or more feedback rows
- **AND** that owner has no `summaries_feedbacks_automatic_thrifting` row
- **WHEN** generate-search-terms runs and will insert terms
- **THEN** a summarizer LLM is called
- **AND** one summary row exists for that owner with non-empty `summary` and `outdated` false
- **AND** the search-term prompt includes that summary

#### Scenario: Outdated summary is refreshed

- **GIVEN** panorama `p1` whose owner has feedback rows
- **AND** a summary row with `outdated` true and previous text `old`
- **WHEN** generate-search-terms runs and will insert terms
- **THEN** a summarizer LLM is called using Enjoei factory records from at most the 250 most recent feedbacks
- **AND** that summary row’s `summary` is replaced
- **AND** `outdated` is false when no newer web write raced the refresh
- **AND** the search-term prompt includes the new summary

#### Scenario: Current summary is reused

- **GIVEN** panorama `p1` whose owner has feedback rows
- **AND** a summary row with `outdated` false and text `kept`
- **WHEN** generate-search-terms runs and will insert terms
- **THEN** no summarizer LLM call is made
- **AND** that summary row still has text `kept` and `outdated` false
- **AND** the search-term prompt includes `kept`

#### Scenario: Unprocessed terms skip summarization

- **GIVEN** panorama `p1` already has unprocessed `search_terms_scraped_products` rows
- **AND** the owner has outdated feedback summary state
- **WHEN** generate-search-terms runs
- **THEN** no summarizer LLM call is made
- **AND** no new search-term rows are inserted
- **AND** the summary row is unchanged

#### Scenario: Summarizer failure does not insert terms

- **GIVEN** panorama `p1` whose owner has feedback rows and a missing or outdated summary
- **AND** the summarizer LLM fails
- **WHEN** generate-search-terms runs
- **THEN** the workflow fails
- **AND** no new `search_terms_scraped_products` rows are inserted for `p1`

#### Scenario: Unsigned request still rejected

- **GIVEN** a POST to `/generate-search-terms-products-scraping` without a valid QStash/Workflow signature
- **WHEN** the worker handles the request
- **THEN** the response status is `401`
- **AND** no summary or search-term row is written

### Requirement: Factory and chunked LLM summarization of recent feedbacks

When the workflow must create or refresh a summary, it MUST take at most the **250 most recent** `feedbacks_automatic_thrifting` rows for that owner (`created_at` descending, then `id` descending). The max-entry cap MUST be read from environment variable `FEEDBACK_SUMMARY_MAX_ENTRIES` (positive integer). When that variable is unset or invalid, the workflow MUST use **250**. Older rows beyond that window MUST NOT be sent to the summarizer.

Each selected row MUST be passed through a marketplace factory before any LLM call. The factory MUST be chosen from the row’s marketplace slug (`json_listed_product.marketplace`, else `json_result.marketplace`, case-insensitive). This change MUST ship an **Enjoei** factory. The LLM payload MUST contain only factory records — never raw `json_search`, `json_result`, or `json_listed_product`, and never listing URLs or image URLs. A row whose marketplace has no factory MUST be omitted. If the window yields zero factory records, the workflow MUST skip the summarizer LLM, MUST NOT insert a summary row, and MUST generate search terms without feedback-summary context.

The Enjoei factory MUST emit only: `marketplace`, `liked`, `reason` (or null), listing `title`, `price`, `currency`, listing `size` when present, `searchTerm`, `gender`, `topSize`, `bottomSize`, and `footSize`.

It MUST NOT send the factory list in one LLM call when the count exceeds the configured chunk size. Chunk size MUST be read from environment variable `FEEDBACK_SUMMARY_CHUNK_SIZE` (positive integer). When that variable is unset or invalid, the workflow MUST use **50**. Chunks MUST be folded in chronological order within the recent window (oldest of the 250 first). Each chunk after the first MUST receive the running summary from the previous chunk as reference so the model increments/updates the summary rather than replacing it from a blank slate. Each summarizer call MUST be persisted in `llm_interactions`. The stored summary text MUST be written in the same language used for generated search terms. The summarizer prompt MUST describe likes and dislikes as **tendencies**, not as an exclusive catalog — it MUST NOT imply that the owner only wants the most frequently liked item, color, or type.

After a successful create/refresh, the workflow MUST persist the final summary text. It MUST set `outdated = false` only if the summary row was still stale relative to the `updated_at` (or equivalent) observed when summarization started. If a newer web write marked the row outdated during the run, the new `summary` text MAY be stored but `outdated` MUST remain true.

#### Scenario: One chunk when factory records are within the chunk limit

- **GIVEN** the owner has 20 Enjoei feedback rows
- **AND** `FEEDBACK_SUMMARY_CHUNK_SIZE` is unset
- **AND** the summary is missing or outdated
- **WHEN** generate-search-terms refreshes the summary
- **THEN** exactly one summarizer LLM call is made
- **AND** that call includes 20 Enjoei factory records
- **AND** the call body does not include `json_search`, `json_result`, `json_listed_product`, listing URLs, or image URLs
- **AND** the summarizer prompt instructs the model to record tendencies without treating frequent likes as exclusive
- **AND** `llm_interactions` contains that call

#### Scenario: Multiple chunks fold the running summary

- **GIVEN** the owner has 120 Enjoei feedback rows
- **AND** `FEEDBACK_SUMMARY_CHUNK_SIZE` is `50`
- **AND** the summary is missing or outdated
- **WHEN** generate-search-terms refreshes the summary
- **THEN** three summarizer LLM calls are made
- **AND** each call receives Enjoei factory records only
- **AND** the second and third calls include the summary text produced by the previous call
- **AND** the persisted `summary` is the text from the last call

#### Scenario: Only the 250 most recent feedbacks are summarized

- **GIVEN** the owner has 300 Enjoei feedback rows
- **AND** `FEEDBACK_SUMMARY_MAX_ENTRIES` is unset
- **AND** the summary is missing or outdated
- **WHEN** generate-search-terms refreshes the summary
- **THEN** the summarizer LLM receives factory records for only the 250 most recently created rows
- **AND** the 50 oldest rows are not included in any summarizer call

#### Scenario: Env override changes chunk size

- **GIVEN** `FEEDBACK_SUMMARY_CHUNK_SIZE` is `10`
- **AND** the owner has 25 Enjoei feedback rows
- **AND** the summary is missing or outdated
- **WHEN** generate-search-terms refreshes the summary
- **THEN** three summarizer LLM calls are made

#### Scenario: Unknown marketplace is omitted from the LLM payload

- **GIVEN** the owner has one feedback whose marketplace slug is not `enjoei`
- **AND** the summary is missing or outdated
- **WHEN** generate-search-terms would refresh the summary
- **THEN** that row is not sent to the summarizer
- **AND** no raw JSON snapshot for that row is included in the prompt

#### Scenario: Concurrent feedback write leaves outdated true

- **GIVEN** a summary refresh started while `outdated` was true
- **AND** web sets `outdated` true again with a newer `updated_at` before persist
- **WHEN** the workflow writes the new summary
- **THEN** `summary` stores the newly generated text
- **AND** `outdated` remains true

### Requirement: Marketplace catalog and language matching

The workflow MUST read `marketplaces_catalog_scraped_products` and the panorama owner's locale (`app_preferences` / domains; default `pt-BR`). A marketplace is eligible when `supported_languages` is non-empty. Search terms MUST be written in the owner's locale when that locale is listed in `supported_languages`; otherwise they MUST be written in a language from `supported_languages`. Terms MUST be distributed across eligible marketplaces (round-robin when more than one). If no marketplace is eligible, the workflow MUST complete without inserting search-term rows and MUST NOT delete existing products or related registers. At first launch the catalog contains only Enjoei with `pt-BR`.

#### Scenario: pt-BR user receives Enjoei terms

- **GIVEN** locale `pt-BR` and catalog row `{ "name": "enjoei", "supported_languages": ["pt-BR"] }`
- **WHEN** generate-search-terms succeeds
- **THEN** every inserted row has `marketplace` equal to `enjoei`
- **AND** `json_search.term` is in Portuguese

#### Scenario: User locale is used when the marketplace supports it

- **GIVEN** the owner's locale is listed in the marketplace `supported_languages`
- **WHEN** generate-search-terms succeeds
- **THEN** `json_search.term` is written in the owner's locale

#### Scenario: Marketplace language is used when the user locale is not supported

- **GIVEN** the owner's locale is not listed in the marketplace `supported_languages`
- **AND** the marketplace lists another language
- **WHEN** generate-search-terms succeeds
- **THEN** `json_search.term` is written in a marketplace-supported language
- **AND** search-term rows are still inserted
- **AND** existing `scraped_products` are unchanged

#### Scenario: Empty catalog leaves last week’s products

- **GIVEN** an empty `marketplaces_catalog_scraped_products`
- **AND** panorama `p1` has existing `scraped_products`
- **WHEN** generate-search-terms runs for `p1`
- **THEN** `p1`’s `scraped_products` and related search/result rows are unchanged
- **AND** no new search-term rows are inserted
- **AND** the workflow does not fail the outbox dispatch

#### Scenario: Terms are capped at ten across marketplaces

- **GIVEN** two eligible marketplaces and an LLM that could propose more than 10 terms
- **WHEN** the workflow persists results
- **THEN** the total number of inserted rows for that run is at most 10
- **AND** both marketplaces appear among the rows when the LLM produced enough terms

### Requirement: Analyze scraped results workflow endpoint

`worker-ai-workflows` MUST host an Upstash Workflow at `POST /analyze-scraped-products-results` (workflow key `analyze-scraped-products-results`). The payload MUST be `{ "wardrobePanoramaId": "<uuid>" }` as stored on the outbox row. A missing or empty id MUST fail the workflow without writing or deleting `scraped_products`. Unsigned requests MUST return `401`.

#### Scenario: Analyze starts for a panorama with unprocessed results

- **GIVEN** a signed request with an existing `wardrobePanoramaId`
- **AND** that panorama has unprocessed `results_search_terms_scraped_products` rows
- **WHEN** `POST /analyze-scraped-products-results` is invoked
- **THEN** the workflow runs the analysis prompt and persists chosen listings

#### Scenario: Unsigned analyze request is rejected

- **GIVEN** a POST to `/analyze-scraped-products-results` without a valid QStash/Workflow signature
- **WHEN** the worker handles the request
- **THEN** the response status is `401`

### Requirement: Atomic swap only when new scraped_products are ready

The analyze workflow MUST load panorama markdown, routine description when present, and unprocessed scrape results for that panorama (`results_search_terms_scraped_products` joined to `search_terms_scraped_products`). When unprocessed results exist, it MUST call the LLM to choose at most one listing per search term and MUST persist the LLM call in `llm_interactions`. Search terms with no usable listing MAY be omitted from the new product set.

The analyze workflow MUST NOT delete `search_terms_scraped_products` or `results_search_terms_scraped_products` except inside the product swap. Only when at least one new `scraped_products` row is ready to insert, the workflow MUST, in a single transaction for that `wardrobe_panorama_id`: delete existing `scraped_products`; insert the chosen listings (same product-type domain as today's clothing-item scraped products), each with `result_search_term_scraped_product_id` set to the `results_search_terms_scraped_products.id` it was chosen from; delete leftover `results_search_terms_scraped_products` and `search_terms_scraped_products` from prior pipeline runs for that panorama (search-term ids not among this run's unprocessed results). It MUST keep the newly inserted `scraped_products`. It MUST keep this run's `search_terms_scraped_products` and `results_search_terms_scraped_products` rows and MUST mark those kept result rows `is_processed = true`. It MUST NOT delete search/result registers before the new product rows are inserted, and MUST NOT delete them when no new products are inserted. Each inserted listed row MUST reference a distinct result id (the column is unique). The workflow MUST NOT insert a listed row without that foreign key.

If there are no unprocessed results, or the LLM yields zero listings to insert, the workflow MUST NOT call a delete, MUST NOT insert `scraped_products`, MUST NOT set a notification, and last week’s `scraped_products` and related registers MUST remain.

#### Scenario: Swap replaces last week when new products are ready

- **GIVEN** panorama `p1` has last week’s `scraped_products` plus this week’s unprocessed result rows for two search terms
- **AND** leftover search-term/result rows from a prior run
- **WHEN** analyze chooses one listing per term and completes successfully
- **THEN** `scraped_products` for `p1` contains only the newly chosen listings
- **AND** last week’s `scraped_products` for `p1` are gone
- **AND** each new listed row stores that listing’s `results_search_terms_scraped_products.id` in `result_search_term_scraped_product_id`
- **AND** no two listed rows store the same result id
- **AND** this run’s `search_terms_scraped_products` and `results_search_terms_scraped_products` rows for `p1` still exist
- **AND** leftover search-term/result rows from the prior run for `p1` are gone

#### Scenario: Empty or failed selection keeps last week

- **GIVEN** panorama `p1` has last week’s `scraped_products`
- **AND** there are no unprocessed results (or the LLM chooses zero listings)
- **WHEN** analyze runs
- **THEN** last week’s `scraped_products` for `p1` still exist
- **AND** related search-term and result rows for `p1` still exist
- **AND** no unread automatic-thrifting notification key is set
- **AND** no DELETE is issued against `search_terms_scraped_products` or `results_search_terms_scraped_products`

### Requirement: Redis cache and notification after successful analysis

After a successful swap that inserted at least one `scraped_products` row, the analyze workflow MUST delete the web list cache key `shopping-suggestions:{userId}` and MUST SET `notification:new-shopping-suggestions:{userId}` to `{"updatedAt":"<ISO-8601>"}`. These keys MUST match the SkyDIIV web app. Redis failures MUST NOT roll back the database writes. The generate-search-terms workflow and the panorama workflow MUST NOT set these keys.

#### Scenario: User is notified after chosen products are saved

- **GIVEN** analysis swapped in one or more `scraped_products` for the panorama owner `u1`
- **WHEN** the workflow finishes the cache step
- **THEN** `shopping-suggestions:u1` is deleted
- **AND** `notification:new-shopping-suggestions:u1` holds an `updatedAt` timestamp

#### Scenario: Redis outage still persists the swap

- **GIVEN** analysis successfully swapped `scraped_products`
- **AND** web Redis is unavailable
- **WHEN** the cache step runs
- **THEN** the database rows from the swap remain
- **AND** the workflow logs a warning rather than failing the swap

### Requirement: Panorama no longer enqueues marketplace scrapes

`POST /generate-wardrobe-panorama` MUST persist markdown panorama content without requiring a trailing shopping-suggestions JSON fence. It MUST NOT insert `outbox_events` for `scrape-shopping-suggestions`. Editorial markdown about what to look for MAY remain in the panorama text.

#### Scenario: Panorama succeeds without scrape outbox

- **GIVEN** a signed panorama workflow run that produces markdown without a trailing JSON array
- **WHEN** the workflow completes
- **THEN** `wardrobe_panorama.content` is saved
- **AND** no new `scrape-shopping-suggestions` outbox row is inserted

#### Scenario: Trailing JSON is not required

- **GIVEN** the LLM returns only markdown sections including “what to look for”
- **WHEN** execute-prompt parses the response
- **THEN** the workflow does not fail for a missing JSON fence

### Requirement: Automatic-thrifting listed fields use envelope encryption

Generate-search-terms, analyze-scraped-products-results, and generate-wardrobe-panorama MUST load listed columns as plaintext after decrypt (panorama markdown, routine description, shopping sizes and gender, feedback summary, feedback reason) and MUST persist listed outputs as ciphertext (panorama content, LLM prompt/response, feedback summary). `json_search` gender and size copies MUST remain plaintext JSON. Application-visible prompt text, term variety rules, Redis notification keys, unsigned `401`, and outbox behavior from the existing requirements are unchanged.

#### Scenario: Search-term prompt uses decrypted sealed inputs

- **GIVEN** panorama `p1` whose `content`, owner routine, shopping gender/sizes, and feedback summary are sealed
- **WHEN** generate-search-terms builds the LLM prompt
- **THEN** the prompt contains the original plaintext panorama, routine, sizes, gender, and summary
- **AND** it does not contain the stored ciphertext of those columns

#### Scenario: Persisted summary is ciphertext while the prompt sees plaintext

- **GIVEN** feedbacks exist and the summary row is missing or outdated
- **WHEN** generate-search-terms refreshes the summary to text `likes blazers`
- **THEN** later prompt construction includes `likes blazers`
- **AND** the stored `summary` column is not `likes blazers`

#### Scenario: Panorama content is sealed without scrape outbox

- **GIVEN** a signed panorama workflow run that produces markdown "# Wardrobe"
- **WHEN** the workflow completes
- **THEN** `wardrobe_panorama.content` is saved as ciphertext
- **AND** no new `scrape-shopping-suggestions` outbox row is inserted
- **AND** a later search-term run for that panorama receives markdown "# Wardrobe"
