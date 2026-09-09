# Observability

The robot exports traces, metrics, and logs through a **vendor-agnostic port**. Grafana Cloud is the current adapter (OTLP/HTTP JSON). Application and presentation code never import Grafana or OTLP types.

See `src/domain/ports/observability.port.ts` and `src/infrastructure/observability/`. Adding another backend: implement the port under `providers/` and register it in `observability.factory.ts`.

## Provider selection (`OBSERVABILITY_PROVIDER`)

| Value | Result |
|---|---|
| `grafana-cloud` | Grafana Cloud OTLP. Incomplete endpoint/headers → warn and noop |
| `noop` | Console NDJSON only |
| unset | `grafana-cloud` if both OTLP keys are set, otherwise noop |
| anything else | Process throws at boot |

## Env

Put keys in local `.env` and in GitHub Environment secret `ROBOT_SCRAPE_PRODUCTS_ENV` (see [ENV.md](./ENV.md)). Terraform already injects that blob as container env.

| Variable | Secret? |
|---|---|
| `OBSERVABILITY_PROVIDER` | no |
| `OTEL_SERVICE_NAME` (default `robot-scrape-products`) | no |
| `DEPLOYMENT_ENVIRONMENT` | no |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | yes |
| `OTEL_EXPORTER_OTLP_HEADERS` (`Authorization=Basic …`, `Authorization=Basic%20…`, the base64 blob alone, or `instanceId:glc_…`) | yes |

From the Grafana Cloud OpenTelemetry Configure page, paste **the value** of each variable (no `export`, no extra quotes). A bare `base64(instanceId:token)` blob is sent as `Authorization: Basic …`. Do not paste only a `glc_…` token without the instance id.

### 401 `OTLP export rejected`

The POST reached Grafana and auth was refused. The warn includes `auth`, `headersEnv` (length/flags of the secret, never the value), and `grafanaError`.

## What is recorded

Each process invocation gets a root `batch.run` span (`compute.provider`, `batch.status`), `batch.run.count`, and `batch.run.duration` (ms). Logs from the composition-root loggers attach when Grafana Cloud is selected. Export runs at shutdown; a Grafana outage does not skip scrape persistence, analyze outbox, or self-delete.

## PII

Forbidden as span/metric attributes: listing HTML, proxy credentials, clothing images, and full outbox payloads.
