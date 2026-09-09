# Observability

This worker exports traces, metrics, and logs through a **vendor-agnostic port**. Grafana Cloud is the current adapter (OTLP/HTTP JSON). Domain and workflow code never import Grafana or OTLP types.

The worker URL stays **origin-only**. No new HTTP path is added. Unsigned `GET /` and QStash-signed POSTs are unchanged (`401` on bad signatures).

See `src/domain/ports/observability.port.ts` and `src/infrastructure/observability/`.

## Port vs adapters

| Layer | Role |
|---|---|
| `ObservabilityPort` | `startSpan`, `recordMetric`, `logger`, `flush` / `shutdown` |
| `grafana-cloud` adapter | POST `{endpoint}/v1/traces`, `/v1/metrics`, `/v1/logs`; also writes console NDJSON |
| `noop` adapter | Console NDJSON only; never calls Grafana |

Adding another backend: implement the port under `infrastructure/observability/providers/` and register the id in `observability.factory.ts`.

## Provider selection (`OBSERVABILITY_PROVIDER`)

| Value | Result |
|---|---|
| `grafana-cloud` | Grafana Cloud OTLP. Incomplete endpoint/headers → warn and noop |
| `noop` | Console only |
| unset | `grafana-cloud` if both OTLP secrets are set, otherwise noop |
| anything else | Worker throws at request start |

## Env

| Variable | Where | Secret? |
|---|---|---|
| `OBSERVABILITY_PROVIDER` | optional wrangler `[vars]` / `.dev.vars` | no |
| `OTEL_SERVICE_NAME` | optional; default `worker-sync` | no |
| `DEPLOYMENT_ENVIRONMENT` | wrangler `[vars]=production`, `[env.staging.vars]=staging` | no |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Worker secret / `.dev.vars` (Grafana OTLP gateway, e.g. `https://otlp-gateway-….grafana.net/otlp`) | yes |
| `OTEL_EXPORTER_OTLP_HEADERS` | Worker secret / `.dev.vars` (`Authorization=Basic …`) | yes |

Do not put OTLP credentials in wrangler.toml `[vars]`. GitHub Environments **staging** and **production** need the two OTEL secrets; CI syncs them with `wrangler secret bulk`.

Locally, leave the OTEL secrets empty in `.dev.vars` to stay on noop.

## What is recorded

Each `fetch` gets a root span (`http.request.method`, `http.route`, `http.response.status_code`), `http.server.request.count`, and `http.server.request.duration` (ms). Logs from `createLogger` attach to that span when Grafana Cloud is selected. Export runs in `waitUntil` so a Grafana outage does not change HTTP status.

## PII

Allowed: `userId` when existing loggers already pass it. Forbidden as span/metric attributes: email, LLM prompt bodies, clothing images, and raw QStash payloads.

Cloudflare `[observability.logs]` in `wrangler.toml` stays enabled (Workers Logs) in addition to OTLP.
