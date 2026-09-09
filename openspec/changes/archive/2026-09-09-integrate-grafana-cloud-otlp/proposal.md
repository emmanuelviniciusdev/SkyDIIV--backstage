## Why

Backstage apps only emit structured NDJSON to stdout (Cloudflare Workers Logs on workers; container stdout on the robot). There is no vendor-neutral telemetry contract and no export to Grafana Cloud, so traces, metrics, and logs cannot be queried, correlated, or alerted on in one place. Operators need OTLP export to Grafana Cloud now, without coupling domain/application code to Grafana so a later backend swap is an infrastructure adapter change.

## What Changes

- Add a vendor-agnostic **observability port** in each app (traces, metrics, logs) following existing Clean Architecture ports/adapters. Domain and application code MUST depend on the port, never on Grafana, OpenTelemetry packages, or OTLP.
- Add a **Grafana Cloud adapter** that exports telemetry over **OTLP/HTTP**. Select it via `OBSERVABILITY_PROVIDER` the same way the robot selects `COMPUTE_PROVIDER` (`oci` | `noop`).
- Add a **noop adapter** used locally, in CI, and whenever Grafana credentials are absent, so health checks, QStash handlers, and the robot batch still run.
- Instrument each **Cloudflare Worker `fetch`** (including unsigned `GET /`) and the **robot batch run** with a root span, RED metrics (count, errors, duration), and log correlation. Existing NDJSON `createLogger` calls keep working; the selected adapter is the log sink (Grafana dual-writes OTLP + console; noop writes console only).
- Document env/secrets per app. Workers: GitHub Environment secrets + `wrangler secret bulk`. Robot: keys in `ROBOT_SCRAPE_PRODUCTS_ENV` / local `.env`. Keep `[observability.logs]` in wrangler.toml.

## Non-goals

- Do not add Grafana dashboards, alert rules, or recording rules as code.
- Do not change QStash signatures, outbox catalog/routes, schedules, workflow payloads, or HTTP status contracts (unsigned POST still `401`; `GET /` still unsigned).
- Do not add a pnpm workspace or shared `packages/` library; apps stay independent Node 22 projects with the same port/factory copied per app.
- Do not instrument skydiiv/web, Python scripts, or Terraform beyond passing robot env keys.
- Do not auto-instrument Postgres, Redis, Gemini, R2, Resend, or Camoufox in this change (boundary spans only).
- Do not rewrite every worker workflow into full domain/application layers; introduce ports/adapters for observability and wire them at each composition root.
- Do not send PII in span/metric attributes (no email, clothing images, prompt bodies, or full QStash payloads).

## Capabilities

### New Capabilities

- `apps/worker-ai-workflows/observability`: OTLP telemetry for AI workflow HTTP requests via a vendor-agnostic port; Grafana Cloud is the default adapter.
- `apps/worker-scheduler/observability`: OTLP telemetry for scheduler HTTP requests (health, weekday, everyday, catch-up) via the same port.
- `apps/worker-outbox-events/observability`: OTLP telemetry for outbox-processor HTTP requests via the same port.
- `apps/worker-notification/observability`: OTLP telemetry for notification HTTP requests via the same port.
- `apps/worker-sync/observability`: OTLP telemetry for sync HTTP requests via the same port.
- `apps/robot-scrape-products/observability`: OTLP telemetry for the weekly OCI batch run via the same port (Node runtime adapter).

### Modified Capabilities

- (none — existing automatic-thrifting and script specs do not change worker-observable HTTP, QStash, DB, Redis, or outbox behavior)

## Impact

- **Affected apps:** `apps/worker-ai-workflows`, `apps/worker-scheduler`, `apps/worker-outbox-events`, `apps/worker-notification`, `apps/worker-sync`, `apps/robot-scrape-products`.
- **skydiiv/web follow-up:** none (no Prisma, outbox catalog, Redis keys, or web env URLs).
- **Schedule / QStash / outbox:** no schedule, signature, or routing changes. Telemetry wraps existing handlers; unsigned POSTs still `401` and MUST still emit a span/log for the rejected request.
- **Env:** new secrets `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` (Grafana Cloud OTLP gateway URL + Basic auth). Optional `OBSERVABILITY_PROVIDER` (`grafana-cloud` | `noop`; default auto-detect). Non-secret `OTEL_SERVICE_NAME` defaults to the app folder name. Staging and production GitHub Environments need the secrets; robot keys go in `ROBOT_SCRAPE_PRODUCTS_ENV`.
- **Dependencies:** OpenTelemetry API plus OTLP/HTTP exporters (Workers-safe HTTP, not gRPC) in each app. Cloudflare Workers must flush via `ExecutionContext.waitUntil` after the response.
- **Docs:** each app README plus a new `docs/OBSERVABILITY.md` (robot: extend `docs/ENV.md` and add `docs/OBSERVABILITY.md`).
