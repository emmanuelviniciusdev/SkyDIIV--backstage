# Grafana Cloud dashboards

Git is the **source of truth** for SkyDIIV backstage Grafana Cloud dashboards. Edits made only in the Grafana UI are overwritten the next time this project deploys.

This directory is an independent Node 22 project (not a Cloudflare Worker). It does not change worker URLs, QStash, or OTLP adapters. Dashboards query telemetry already exported by the apps.

## Dashboards

| File | uid | Purpose |
|---|---|---|
| `dashboards/overview.json` | `skydiiv-bs-overview` | RED by service, health (`GET /`) vs work, robot batch |
| `dashboards/scheduled-pipelines.json` | `skydiiv-bs-schedules` | Weekday CRON routes, AI workflows, robot batch |
| `dashboards/service-red.json` | `skydiiv-bs-service-red` | Drill-down with `$service` + `$environment`, Loki errors, Tempo traces |

Folder in Grafana Cloud: **SkyDIIV Backstage** (`skydiiv-backstage`). Tags: `skydiiv`, `backstage`. Default time range: last 24h.

There is no web ↔ backstage interactions dashboard. Outbox, welcome email, and language sync still appear as services on Overview and Service RED.

## Queries

OTLP metrics are **gauges** (count = 1 per request, duration in ms). Do **not** use Prometheus `rate()`. Use:

| Intent | Shape |
|---|---|
| Volume | `count_over_time(http_server_request_count{...}[$__interval])` |
| Average latency | `avg_over_time(http_server_request_duration{...}[$__interval])` |
| p95 latency | `quantile_over_time(0.95, http_server_request_duration{...}[$__interval])` |
| Errors | same count query with `http_response_status_code=~"4..\|5.."` |
| Robot | `batch_run_count` / `batch_run_duration` with `batch_status` |

Labels: `service_name`, `deployment_environment`, `http_route`, `http_request_method`, `http_response_status_code`.

Datasource placeholders in JSON (`DS_PROMETHEUS`, `DS_LOKI`, `DS_TEMPO`) are replaced at deploy time from `GET /api/datasources`.

## Local commands

```bash
cd observability/grafana
npm ci
npm run lint
npm test
npm run validate
```

`npm run validate` never calls Grafana Cloud.

Grafana Cloud returns **403** (not 404) for `GET /api/folders/<uid>` when the folder does not exist. Deploy lists `GET /api/folders` and creates `SkyDIIV Backstage` if the uid is missing.

To upsert into a stack:

```bash
export GRAFANA_URL="https://<stack>.grafana.net"
export GRAFANA_SERVICE_ACCOUNT_TOKEN="..."
npm run deploy
```

Do not put these values in wrangler.toml, `.dev.vars`, or git.

## GitHub Actions

`.github/workflows/deploy-grafana-dashboards.yml` validates on pull requests that touch this directory or the workflow file. On push to `staging` / `main` (and `workflow_dispatch` on those branches) it upserts dashboards.

Add these **GitHub Environment** secrets on `staging` and `production` (distinct from worker OTLP write secrets):

| Secret | Value |
|---|---|
| `GRAFANA_URL` | Grafana Cloud stack origin, no trailing path (example `https://<stack>.grafana.net`) |
| `GRAFANA_SERVICE_ACCOUNT_TOKEN` | Service account token with `dashboards:write`, `folders:write`, `datasources:read` |

Missing secrets fail only this deploy job. Worker and robot deploys are unchanged.

## Adding a panel

1. Edit the dashboard JSON under `dashboards/`.
2. Keep the existing `uid`. Use `_over_time` queries. Do not add email, prompt, or raw QStash payload fields.
3. Run `npm test` and `npm run validate`.
4. Merge; CI deploys on `staging` / `main`.
