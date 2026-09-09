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
| `OTEL_SERVICE_NAME` | optional; default `worker-notification` | no |
| `DEPLOYMENT_ENVIRONMENT` | wrangler `[vars]=production`, `[env.staging.vars]=staging` | no |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Worker secret / `.dev.vars` (Grafana OTLP gateway, e.g. `https://otlp-gateway-….grafana.net/otlp`) | yes |
| `OTEL_EXPORTER_OTLP_HEADERS` | Worker secret / `.dev.vars` (`Authorization=Basic …`, `Authorization=Basic%20…`, the base64 blob alone, or `instanceId:glc_…`) | yes |

Do not put OTLP credentials in wrangler.toml `[vars]`. GitHub Environments **staging** and **production** need the two OTEL secrets; CI syncs them with `wrangler secret bulk`.

From the Grafana Cloud OpenTelemetry Configure page, paste **the value** of each variable (no `export`, no extra quotes):

| Variable | Value |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `https://otlp-gateway-prod-<region>.grafana.net/otlp` (no `/v1/traces` suffix) |
| `OTEL_EXPORTER_OTLP_HEADERS` | `Authorization=Basic%20…`, `Authorization=Basic <blob>`, the base64 blob alone, or `instanceId:glc_…` |

The adapter percent-decodes the header. A bare `base64(instanceId:token)` blob is sent as `Authorization: Basic …`. Do not paste only a `glc_…` token without the instance id.

Locally, leave the OTEL secrets empty in `.dev.vars` to stay on noop.

### 401 `OTLP export rejected`

The POST reached Grafana and auth was refused. The warn includes `auth`, `headersEnv` (length/flags of the secret, never the value), and `grafanaError`.

| `auth` / `headersEnv` | Typical cause |
|---|---|
| `missing` + `looksLikeBase64` | old parser; the blob alone did not become `Authorization` |
| `other` + `hasPercent` | `Basic%20` was not decoded |
| `basic` + Grafana `invalid token` | wrong instance id or token scopes (`logs:write`, `metrics:write`, `traces:write`) |

## What is recorded

Each `fetch` gets a root span (`http.request.method`, `http.route`, `http.response.status_code`), `http.server.request.count`, and `http.server.request.duration` (ms). Logs from `createLogger` attach to that span when Grafana Cloud is selected. Export runs in `waitUntil` so a Grafana outage does not change HTTP status.

## PII

Allowed: `userId` when existing loggers already pass it. Forbidden as span/metric attributes: email, LLM prompt bodies, clothing images, and raw QStash payloads.

Cloudflare `[observability.logs]` in `wrangler.toml` stays enabled (Workers Logs) in addition to OTLP.
