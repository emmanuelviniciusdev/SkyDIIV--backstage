## Why

Backstage apps already export OTLP traces, metrics, and logs to Grafana Cloud, but operators still have no saved dashboards and no way to provision them. Version-controlled dashboards plus a deploy pipeline make RED, errors, and scheduled-pipeline latency repeatable across staging and production instead of click-ops in the Grafana UI.

## What Changes

- Add versioned Grafana dashboard JSON under `observability/grafana/`, covering:
  - a platform overview (all backstage services)
  - scheduled pipelines (weekday CRON, AI workflows, robot batch)
  - a per-service RED drill-down (service + environment variables)
- Add a small Node 22 deploy tool in that directory that upserts the dashboards (and a Grafana folder) into Grafana Cloud via the HTTP API, resolving Prometheus/Loki/Tempo datasource UIDs at deploy time.
- Add a GitHub Actions workflow that validates dashboard JSON on pull requests and deploys to Grafana Cloud on push to `staging` / `main` (and `workflow_dispatch`), using GitHub Environment secrets.
- Document the dashboard set, metric queries, and required Grafana Cloud secrets. Link each app `docs/OBSERVABILITY.md` to that directory.
- Do not change worker/robot HTTP, QStash, outbox, schedules, or OTLP adapters. Dashboards query telemetry already specified by `apps/*/observability`.

## Non-goals

- Do not add Grafana alert rules, notification policies, or recording rules.
- Do not change OTLP adapters, metric names, or gauge vs sum types in any app.
- Do not instrument `skydiiv/web`, add Prisma/outbox catalog events, or change Redis keys.
- Do not add a pnpm workspace or shared `packages/` library.
- Do not introduce Terraform/Grizzly/jsonnet for Grafana; JSON + the Grafana HTTP API is enough.
- Do not change QStash signatures, workflow payloads, worker URLs, or HTTP status contracts.
- Do not auto-instrument Postgres, Redis, Gemini, R2, Resend, or Camoufox.
- Do not add a web ↔ backstage interactions dashboard (outbox, welcome email, language sync). Overview and per-service RED still include those workers as services.

## Capabilities

### New Capabilities

- `observability/grafana`: Versioned Grafana Cloud dashboards for backstage RED and scheduled pipelines, plus a CI pipeline that validates and upserts them.

### Modified Capabilities

- (none — existing `apps/*/observability` specs already require the metrics, traces, and logs these dashboards query; export behavior does not change)

## Impact

- **Affected area:** new `observability/grafana/` (dashboard JSON, deploy script, README) and `.github/workflows/` (one new workflow). No app under `apps/` changes runtime behavior.
- **skydiiv/web follow-up:** none (no Prisma schema, outbox catalog, Redis keys, or env URLs).
- **Schedule / QStash / outbox:** none. Dashboards filter existing `http.route` / `service.name` labels for scheduled worker and robot paths; they do not publish, consume, or retry messages.
- **Env / secrets:** GitHub Environments `staging` and `production` need `GRAFANA_URL` (stack origin, e.g. `https://<stack>.grafana.net`) and `GRAFANA_SERVICE_ACCOUNT_TOKEN` (dashboards:write + folders:write + datasources:read). These are distinct from the existing OTLP write secrets.
- **Docs:** `observability/grafana/README.md` plus a short pointer from each app `docs/OBSERVABILITY.md`.
