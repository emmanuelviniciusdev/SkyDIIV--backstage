# Generate Search Terms Products Scraping Workflow

This document describes the **generate-search-terms-products-scraping** workflow: how it is triggered, how it optionally builds a per-user feedback summary, and how it persists marketplace search terms for `robot-scrape-products` (Enjoei).

---

## Overview

Friday automatic thrifting turns a wardrobe panorama into at most 10 unprocessed `search_terms_scraped_products` rows. Before the search-term LLM runs, the workflow may create or reuse a feedback summary so likes/dislikes steer the terms **without collapsing variety** (many likes on black shirts must not produce only black-shirt queries). Enjoei scraping itself is unchanged: the robot still reads those rows later the same day.

**Hosted in:** `worker-ai-workflows`  
**Endpoint:** `POST /generate-search-terms-products-scraping`  
**Payload:** `{ "wardrobePanoramaId": "<uuid>" }`

A missing or empty `wardrobePanoramaId` fails the workflow without inserting search terms. Unsigned requests return `401`.

---

## End-to-End Architecture

```mermaid
sequenceDiagram
  participant OB as worker-outbox-events
  participant AI as worker-ai-workflows
  participant DB as Neon
  participant LLM as Gemini
  participant R as robot-scrape-products

  OB->>AI: POST /generate-search-terms-products-scraping
  Note over AI: skip if unprocessed terms exist
  AI->>DB: load panorama, prefs, catalog
  alt no eligible marketplace
    AI-->>AI: exit — no writes
  else will generate terms
    AI->>DB: count feedbacks; load summaries_feedbacks_automatic_thrifting
    alt zero feedbacks
      AI->>DB: if outdated row exists, clear summary (CAS)
    else outdated false
      AI-->>AI: reuse stored summary
    else missing or outdated
      loop chunks of 50 within 250 most recent
        AI->>DB: page recent feedbacks
        AI->>AI: Enjoei factory (no raw JSON)
        AI->>LLM: fold running summary
        AI->>DB: llm_interactions
      end
      AI->>DB: upsert summary (CAS outdated)
    end
    AI->>LLM: search-term prompt (summary if non-empty; keep variety)
    AI->>DB: insert search_terms_scraped_products
  end
  Note over R: Friday GHA scrapes Enjoei from those rows
```

---

## Triggering

`worker-scheduler` Friday flow inserts one PENDING `outbox_events` row per `wardrobe_panorama` and publishes `{ outboxEventId }` to `{WORKER_OUTBOX_EVENTS_URL}/process-outbox-event`. `worker-outbox-events` forwards `{ wardrobePanoramaId }` to this endpoint. Catch-up retries stuck `PENDING` rows.

Do not publish directly to `WORKER_AI_WORKFLOWS_URL` from the scheduler. Payload and route are unchanged.

---

## Workflow Execution Flow

**Source:** `src/workflows/generate-search-terms-products-scraping/workflow.ts`  
**Registration:** `src/workflows/index.ts` under key `generate-search-terms-products-scraping`

| Step | Name | What it does |
|---|---|---|
| 1 | `skip-if-unprocessed` | If the panorama already has `is_processed = false` search-term rows, **exit**. No summary writes. |
| 2 | `load-context` | Panorama markdown, locale, routine, shopping prefs, marketplace catalog. If no eligible marketplace, **exit**. |
| 3 | `plan-feedback-summary` | Count `feedbacks_automatic_thrifting`; load `summaries_feedbacks_automatic_thrifting`. |
| 4 | `summarize-feedback-chunk-{i}` | Only on create/refresh: factory the page, one Gemini call, `llm_interactions`. |
| 5 | `persist-feedback-summary` | Insert/update summary, or clear a stale empty row. CAS on `outdated` / `updated_at`. |
| 6 | `build-prompt` | Search-term prompt; optional feedback block with a **variety** instruction. |
| 7 | `execute-prompt` | Search-term LLM; `llm_interactions`. |
| 8 | `insert-search-terms` | At most 10 unprocessed rows. Does not delete `scraped_products`. |

A required summarizer failure fails the workflow **before** search-term insert.

### Feedback summary resolution

Uses `feedbacks_automatic_thrifting` and at most one `summaries_feedbacks_automatic_thrifting` row (`user_id` unique). Web never inserts that row; it only sets `outdated = true` when the row exists. This worker creates and refreshes `summary`.

| Situation | Behavior |
|---|---|
| Zero feedback rows | Skip summarizer LLM. Do not insert a summary row. If an existing row is `outdated`, set `summary` to empty and `outdated` false (CAS). Search terms generate without a feedback section. |
| Feedbacks exist, no summary row | Create from factory records (chunked LLM). Persist `outdated = false`. |
| Feedbacks exist, `outdated = true` | Rebuild from factory records of the recent window. Persist new text; `outdated = false` only if no newer web write. |
| Feedbacks exist, `outdated = false` | Reuse stored `summary`. No summarizer LLM. |
| Recent window factories to zero records | Skip summarizer; generate terms without summary. |

### Enjoei factory (no raw JSON)

Rows go through a marketplace factory **before** Gemini. Enjoei is the only factory. Payload fields: `marketplace`, `liked`, `reason`, `title`, `price`, `currency`, `size` (`json_result.metadata.size`), `searchTerm`, `gender`, `topSize`, `bottomSize`, `footSize`. Never send `json_search` / `json_result` / `json_listed_product`, listing URLs, or image URLs. Unknown marketplace slugs are omitted.

### Caps and env

| Var | Default | Role |
|---|---|---|
| `FEEDBACK_SUMMARY_MAX_ENTRIES` | `250` | Most recent feedbacks considered (`ORDER BY created_at DESC, id DESC`). Positive integer; unset/invalid → 250. |
| `FEEDBACK_SUMMARY_CHUNK_SIZE` | `50` | Factory records per summarizer LLM call. Fold chronological (oldest of the window first); later chunks receive the running summary. Positive integer; unset/invalid → 50. |

Both are `wrangler.toml` `[vars]`, not secrets. Worker URLs stay origin-only.

### Variety

The search-term prompt treats the summary as a **steer**: avoid disliked patterns, bias toward likes, keep types/colors/styles varied from the panorama. The summarizer prompt records **tendencies**, not exclusive wants.

### CAS persist

```sql
-- create/refresh
INSERT … ON CONFLICT (user_id) DO UPDATE
SET summary = EXCLUDED.summary,
    outdated = CASE
      WHEN updated_at <= :readAt AND outdated = true THEN false
      ELSE outdated
    END, …

-- zero feedbacks + outdated row
UPDATE … SET summary = '', outdated = false
WHERE user_id = :userId AND outdated = true AND updated_at <= :readAt
```

`created_by` / `updated_by` = `worker-ai-workflows`.

---

## Tables

| Table | Role |
|---|---|
| `wardrobe_panorama` | Source markdown |
| `feedbacks_automatic_thrifting` | Like/dislike snapshots (web) |
| `summaries_feedbacks_automatic_thrifting` | One AI summary per user |
| `search_terms_scraped_products` | Inserted terms (`marketplace` e.g. `enjoei`) |
| `llm_interactions` | Search-term and summarizer calls |
| `scraped_products` | Untouched until analyze |

Prisma/schema for these tables lives in skydiiv/web. This worker does not migrate.

---

## Env

| Name | Kind | Notes |
|---|---|---|
| `FEEDBACK_SUMMARY_CHUNK_SIZE` | var | Default `50` |
| `FEEDBACK_SUMMARY_MAX_ENTRIES` | var | Default `250` |
| `GEMINI_API_KEY` | secret | Summarizer + search-term LLM |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | secret | Reads vs writes |
| `QSTASH_*` / `WORKER_AI_WORKFLOWS_URL` | existing | Unsigned POST → 401 |

No new QStash route, workflow key, or Redis keys.
