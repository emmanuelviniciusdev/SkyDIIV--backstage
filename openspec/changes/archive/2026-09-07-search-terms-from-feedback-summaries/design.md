## Context

See proposal.md for why. Specs: `specs/apps/worker-ai-workflows/automatic-thrifting/spec.md`.

`generate-search-terms-products-scraping` already follows `createWorkflow` + `context.run` steps: skip if unprocessed terms exist, load panorama/routine/prefs/catalog, build prompt, Gemini, insert ≤10 `search_terms_scraped_products`. Payload stays `{ wardrobePanoramaId }`. `serveMany` key is the last path segment (no `/`).

skydiiv/web already shipped:

- `feedbacks_automatic_thrifting` — like/dislike + optional reason + JSON snapshots; unique `(user_id, scraped_product_id)`
- `summaries_feedbacks_automatic_thrifting` — one row per user (`user_id` unique), `summary` text, `outdated` boolean. Web only runs `UPDATE … SET outdated = true WHERE user_id = :id` when the row exists. Web never inserts the row and never publishes an outbox event.

This change is the backstage half of that contract. `robot-scrape-products` (Enjoei) is unchanged; it still scrapes whatever terms this workflow inserts.

## Goals / Non-Goals

**Goals:**

- Fold summary resolution into the existing generate-search-terms workflow after it has committed to producing terms, using postgres.js repositories, per-marketplace factories, and Zod on summarizer output.
- Use the summary as a steer so disliked patterns are avoided and liked ones can be favored, without collapsing the ≤10 terms onto a single frequent like.
- Keep each Gemini call in its own `context.run` so QStash retries a single chunk, not the whole fold.
- Honor web’s race: never blindly set `outdated = false`.

**Non-Goals:**

- New workflow keys, endpoints, or outbox catalog entries.
- Changing analyze, scheduler, robot, or Redis keys.
- Prisma / schema work in this repo.

## Decisions

### 1. Summarize inside generate-search-terms, not a separate job

Web does not enqueue on feedback writes. The user-visible need is “before generating search terms.” Resolve the summary in this workflow after `skip-if-unprocessed` and after “has eligible marketplace,” then build the search-term prompt.

- Alternative considered: dedicated `summarize-automatic-thrifting-feedback` workflow + new outbox event. Rejected — web explicitly does not catalog/publish events; a Friday-only refresh is enough.
- Alternative considered: summarize even when the run will skip insert. Rejected — wasted LLM spend; catch-up of unprocessed terms must not mutate summary state.

### 2. Rebuild from the 250 most recent feedbacks; “previous summary” is the running fold

When create/refresh is required, load at most `FEEDBACK_SUMMARY_MAX_ENTRIES` rows (default **250**) with `ORDER BY created_at DESC, id DESC`. Fold that window in chronological order (oldest of the window first) so recent taste lands last. Chunk 1 starts from an empty running summary. Chunk *n*+1 receives the text returned by chunk *n*. Do not seed chunk 1 with the stored `summary`: `outdated` can mean deletes or like→dislike edits, so incrementing a stale paragraph would keep retracted signal. Rows older than the window are not sent to the LLM.

- Alternative considered: summarize every historical row. Rejected — the user capped the LLM window at the 250 most recent.
- Alternative considered: delta-only (new rows since `updated_at`). Rejected — misses updates and deletes inside the window.

### 3. Default chunk size 50; max entries 250; both env-tunable

Factory records are small, so 250 Enjoei records can fit one Gemini call, but folding 50 at a time still yields a cleaner running summary. Defaults: **`FEEDBACK_SUMMARY_CHUNK_SIZE` = 50**, **`FEEDBACK_SUMMARY_MAX_ENTRIES` = 250**. Parse each as a positive integer; unset/invalid → that default. Put both in `wrangler.toml` `[vars]` (and `[env.staging.vars]`), `.env.example`, not Wrangler secrets. Worker URLs stay origin-only; these vars are not URLs.

Each chunk step **re-queries** the recent window from Neon, factories that page, and sends only factory output. The workflow closure only carries `{ userId, locale, chunkSize, maxEntries, chunkIndex, runningSummary, readAt }` — not JSON snapshots.

### 4. Marketplace factory registry; Enjoei is the only factory

Do not send `json_search`, `json_result`, or `json_listed_product` to Gemini. Resolve marketplace from `json_listed_product.marketplace`, else `json_result.marketplace` (trim, case-insensitive). Dispatch to a factory map keyed by catalog slug (`enjoei`). Unknown slugs are omitted (debug log); never fall back to dumping the snapshot.

`EnjoeiFeedbackFactory` output (Zod):

| Field | Source |
|---|---|
| `marketplace` | `"enjoei"` |
| `liked` | row `liked` |
| `reason` | row `reason` (null if empty) |
| `title` | `json_listed_product.title` else `json_result.title` |
| `price` | listed `price` else `json_result.price` |
| `currency` | listed `currency` else `json_result.currency` |
| `size` | `json_result.metadata.size` (Enjoei listing size) |
| `searchTerm` | `json_search.term` else listed `searchTerm` |
| `gender` | `json_search.gender` |
| `topSize` / `bottomSize` / `footSize` | `json_search` |

Drop URLs, `image_url` / `imageUrl`, `scrapingMetadata`, ids, and any leftover JSON. Missing optional fields are null; do not fail the chunk.

A later marketplace adds another factory module and a map entry; generate-search-terms stays marketplace-agnostic.

Zod-parse the summarizer LLM to a single non-empty trimmed string.

`CREATED_BY` / `updated_by` = `worker-ai-workflows`, same as search-term inserts.

- Alternative considered: one generic compact mapper for all marketplaces. Rejected — the user requires a factory per marketplace; Enjoei size lives in `metadata.size`, which is not a shared contract.

### 5. Workflow steps

Existing key `generate-search-terms-products-scraping` (unchanged path). After load-context:

| Step | Name | Role |
|---|---|---|
| plan | `plan-feedback-summary` | Count feedbacks; load summary row; record `readAt`; return `skip` / `reuse` / `refresh` / `clear-stale-empty` |
| loop | `summarize-feedback-chunk-{i}` | Only if `refresh`; factory the page; one Gemini call with factory records only; `llm_interactions` |
| persist | `persist-feedback-summary` | INSERT or UPDATE `summary`; CAS `outdated` |
| existing | `build-prompt` … | Include summary when non-empty |

```mermaid
sequenceDiagram
  participant OB as worker-outbox-events
  participant AI as worker-ai-workflows
  participant DB as Neon
  participant LLM as Gemini
  participant R as robot-scrape-products

  OB->>AI: POST /generate-search-terms-products-scraping
  Note over AI: skip-if-unprocessed; load-context
  alt no eligible marketplace or unprocessed terms
    AI-->>AI: exit (no summary writes)
  else will generate terms
    AI->>DB: count feedbacks; load summaries_feedbacks_automatic_thrifting
    alt zero feedbacks
      AI->>DB: if outdated row exists, clear summary and outdated
    else outdated false
      AI-->>AI: reuse stored summary
    else missing or outdated
      loop each chunk of 50 within the 250 most recent
        AI->>DB: page recent feedbacks
        AI->>AI: Enjoei factory (no raw JSON)
        AI->>LLM: fold running summary
        AI->>DB: llm_interactions
      end
      AI->>DB: upsert summary (CAS outdated)
    end
    AI->>LLM: search-term prompt (summary if non-empty)
    AI->>DB: insert search_terms_scraped_products
  end
  Note over R: Friday GHA still scrapes Enjoei from those rows
```

Persist SQL (refresh/create), compare on the `updated_at` observed at plan time:

```sql
INSERT INTO summaries_feedbacks_automatic_thrifting
  (id, user_id, summary, outdated, created_by, updated_by, created_at, updated_at)
VALUES (...)
ON CONFLICT (user_id) DO UPDATE
SET summary = EXCLUDED.summary,
    outdated = CASE
      WHEN summaries_feedbacks_automatic_thrifting.updated_at <= :readAt
       AND summaries_feedbacks_automatic_thrifting.outdated = true
      THEN false
      ELSE summaries_feedbacks_automatic_thrifting.outdated
    END,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();
```

If web wrote during the fold, keep `outdated = true` but still store the new text; this run’s search-term prompt uses the in-memory fold result.

Zero feedbacks + existing outdated row: `UPDATE … SET summary = '', outdated = false` with the same CAS. Prompt omits the section.

Summarizer or persist failure throws out of `context.run` so the workflow fails and outbox catch-up retries. Do not insert search terms after a failed required refresh.

### 6. Prompt injection, locale, and variety

Extend `buildGenerateSearchTermsPrompt` with optional `feedbackSummary`. When non-empty, add a labeled block (taste / like-dislike history) that:

- Tells the model to **avoid disliked** patterns and treat liked ones as a **bias**, not a filter.
- Requires **variety** across the ≤10 terms: different garment types, colors, and styles from the panorama and routine, not N near-duplicates of the most frequent like (e.g. not ten “black shirt” queries because the owner liked black shirts a lot).
- Still fills wardrobe gaps from the panorama; the summary MUST NOT override that job.

The summarizer prompt MUST phrase the stored text as tendencies (“often likes…”, “dislikes…”) and MUST forbid exclusive wording (“only wants…”, “always search for…”).

Summary language = `resolveSearchTermsLocale` (same as `term`).

No Redis. No new QStash routes. Unsigned POSTs still 401 via existing `serveMany` verification.

- Alternative considered: hard-code a diversity post-filter on parsed terms (drop near-duplicates). Rejected for this change — prompt contract first; a parser-side cap would need a similarity rule we do not have.

## Risks / Trade-offs

- [Long-running fold vs Workflow step limits] → Window is 250; chunk default 50; page from DB; unique step names `summarize-feedback-chunk-{i}`.
- [Stale summary vs web write during fold] → CAS on `updated_at` / `outdated`; this run still uses the just-built text.
- [Empty factory fields on legacy snapshots] → Still send `liked` + `reason` + whatever Enjoei fields exist; do not fail the chunk.
- [Unknown marketplace in the window] → Omit; if zero factory records remain, skip summarizer and generate terms without summary.
- [250 cap drops older taste] → Accepted; operators can raise `FEEDBACK_SUMMARY_MAX_ENTRIES`.
- [Summary overfits to a frequent like] → Search-term and summarizer prompts require variety / non-exclusive wording; unit tests assert those instructions are present. LLM output diversity is not mechanically enforced.

## Migration Plan

1. Confirm Neon already has both tables (web change archived 2026-09-07).
2. Deploy `worker-ai-workflows` (staging then main). No scheduler/outbox/robot deploy. No new GitHub Environment secrets.
3. First Friday run creates/reuses summaries as needed; Enjoei scrape later that day consumes the new terms.
4. Rollback: revert the worker. Summary rows remain; web `outdated` behavior is unchanged; next generate without this code ignores the table.

## Open Questions

None.
