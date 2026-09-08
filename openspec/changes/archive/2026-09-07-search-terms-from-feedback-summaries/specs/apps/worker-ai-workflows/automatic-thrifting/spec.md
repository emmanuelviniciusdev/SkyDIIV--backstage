## MODIFIED Requirements

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

## ADDED Requirements

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
