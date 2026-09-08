## 1. worker-ai-workflows — env and repositories

- [x] 1.1 Add `FEEDBACK_SUMMARY_CHUNK_SIZE = "50"` and `FEEDBACK_SUMMARY_MAX_ENTRIES = "250"` to `wrangler.toml` `[vars]` and `[env.staging.vars]`, document both in `.env.example`, and add parsers that return a positive integer or the default when unset/invalid; verify unit tests cover unset, valid numbers, `"0"`, and `"abc"` for both vars
- [x] 1.2 Add postgres.js repositories for `feedbacks_automatic_thrifting` (count by `user_id`; load at most `maxEntries` most recent via `ORDER BY created_at DESC, id DESC LIMIT n`) and `summaries_feedbacks_automatic_thrifting` (find by `user_id`; upsert summary with the CAS `outdated` SQL from design.md; clear empty outdated row); verify unit tests assert SQL tables/columns, the 250-cap query, `CREATED_BY = worker-ai-workflows`, and that `outdated` stays true when `updated_at` is newer than `readAt`

## 2. worker-ai-workflows — Enjoei factory and summarizer

- [x] 2.1 Add a marketplace factory registry keyed by slug and an `EnjoeiFeedbackFactory` that maps a feedback row to `{ marketplace, liked, reason, title, price, currency, size, searchTerm, gender, topSize, bottomSize, footSize }` and omits URLs, images, ids, and raw JSON; unknown slugs return null; verify unit tests: Enjoei happy path (including `json_result.metadata.size`), missing optional fields, unknown marketplace omitted, and no snapshot keys in the factory output
- [x] 2.2 Add a Gemini summarizer prompt plus Zod parse to a single non-empty trimmed string in the search-term locale, and a chunk-fold helper over the recent window (chronological order, empty running summary on chunk 1); the summarizer prompt MUST describe likes/dislikes as tendencies, not exclusive wants; verify unit tests: 20 Enjoei rows / default 50 → 1 call of factory records only; 120 / 50 → 3 calls with running summary; 300 rows / max 250 → oldest 50 never sent; 25 / chunk 10 → 3 calls; prompt forbids exclusive wording; LLM error is rethrown after the error audit row

## 3. worker-ai-workflows — generate-search-terms workflow

- [x] 3.1 Add `plan-feedback-summary`, per-chunk `summarize-feedback-chunk-{i}`, and `persist-feedback-summary` `context.run` steps after eligible-marketplace checks and before `build-prompt`; skip summarizer LLM when there are no feedbacks, `outdated` is false, or the window factories to zero records; fail the workflow without inserting search terms when a required summarizer call fails; verify integration tests cover skip/reuse/create/refresh, unprocessed-terms skip (no summary writes), summarizer failure (no `search_terms_scraped_products` insert), zero-feedback clearing of an outdated row, and that mocked LLM prompts contain factory records rather than raw JSON
- [x] 3.2 Extend `buildGenerateSearchTermsPrompt` with optional `feedbackSummary` and pass the resolved text from the new steps; omit the section when empty; when set, instruct the model to keep variety and not restrict terms to the most frequent liked item; verify `tests/unit/i18n/generate-search-terms-prompt.test.ts` includes the summary when set, omits it when null/empty, asserts the variety instruction, and still covers panorama/routine/preferences and existing locale behavior
- [x] 3.3 Confirm unsigned `POST /generate-search-terms-products-scraping` still returns 401 in existing worker tests and that no new workflow key or outbox route is registered

## 4. worker-ai-workflows — docs

- [x] 4.1 Add `docs/GENERATE_SEARCH_TERMS_PRODUCTS_SCRAPING.md` covering trigger, skip rules, feedback-summary resolution (create / reuse / refresh / no-feedback), Enjoei factory (no raw JSON), 250 most-recent cap, chunk env default 50, CAS on `outdated`, that the summary steers terms without collapsing variety, and that Enjoei scraping is unchanged; link it from `README.md` in place of (or in addition to) the I18N-only generate-search-terms row
- [x] 4.2 Update `docs/I18N.md` generate-search-terms section to mention the optional feedback-summary block and that summary text follows `resolveSearchTermsLocale`; verify the README endpoint table points at the new doc

## 5. worker-ai-workflows — quality

- [x] 5.1 Run `npm run lint` and `npm run test` in `apps/worker-ai-workflows` and verify both succeed
