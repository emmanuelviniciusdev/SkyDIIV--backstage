# apps/worker-sync/observability Specification

## Purpose

Export traces, metrics, and logs from worker-sync to Grafana Cloud over OTLP without changing locale-sync workflow or QStash contracts, and without coupling handlers to Grafana.

## Requirements

### Requirement: Request telemetry is emitted for every fetch

The worker MUST record a root span, request count/error/duration metrics, and structured logs for every HTTP request, including unsigned `GET /` and signed `POST /sync/language`. Resource attributes MUST include `service.name` `worker-sync`. Span attributes MUST include HTTP method, path, and status code. Telemetry attributes MUST NOT include email, clothing images, LLM prompt bodies, or full QStash payloads.

#### Scenario: Health check is recorded

- **GIVEN** the worker is running
- **WHEN** a client sends `GET /`
- **THEN** the response status is `200` with `{ status: "ok", timestamp }`
- **AND** a span is recorded for method `GET`, path `/`, status `200`
- **AND** a request-duration metric is recorded

#### Scenario: Sync-language POST is recorded

- **GIVEN** a valid QStash signature
- **WHEN** the worker handles `POST /sync/language`
- **THEN** the workflow response status is unchanged from today
- **AND** a span is recorded for method `POST`, path `/sync/language`, and the HTTP status returned

### Requirement: Grafana Cloud OTLP export when configured

When `OBSERVABILITY_PROVIDER` is `grafana-cloud`, or when it is unset and OTLP endpoint plus headers are present, the worker MUST export traces, metrics, and logs over OTLP/HTTP to the configured Grafana Cloud gateway before the isolate is recycled. Console NDJSON logs MUST still be emitted.

#### Scenario: Configured worker exports OTLP

- **GIVEN** `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` are set
- **AND** `OBSERVABILITY_PROVIDER` is unset or `grafana-cloud`
- **WHEN** the worker handles any HTTP request
- **THEN** traces, metrics, and logs are exported to that OTLP endpoint
- **AND** console NDJSON for the same request is still written

### Requirement: Missing backend does not change HTTP behavior

When `OBSERVABILITY_PROVIDER` is `noop`, or when Grafana Cloud credentials are absent, the worker MUST still serve requests. It MUST NOT call Grafana Cloud. Console NDJSON logs MUST still be emitted.

#### Scenario: Local worker without Grafana credentials

- **GIVEN** OTLP endpoint and headers are unset
- **WHEN** a client sends `GET /`
- **THEN** the response status is `200`
- **AND** no OTLP export is attempted
- **AND** console NDJSON is written

### Requirement: Export failure MUST NOT fail the request

An OTLP export error MUST be logged and MUST NOT change the HTTP status or sync side effects.

#### Scenario: Grafana Cloud is unreachable

- **GIVEN** Grafana Cloud OTLP is configured
- **AND** the OTLP export fails
- **WHEN** the worker handles `GET /`
- **THEN** the response status is still `200`
- **AND** the failure is logged

### Requirement: Unsigned sync POST still returns 401 and is recorded

QStash signature verification MUST be unchanged. An unsigned or invalid `upstash-signature` on `POST /sync/language` MUST return `401`, MUST NOT start the workflow, and MUST still record telemetry for the rejected request.

#### Scenario: Unsigned sync/language

- **GIVEN** `POST /sync/language` with no valid `upstash-signature`
- **WHEN** the worker handles the request
- **THEN** the response status is `401`
- **AND** no workflow run starts
- **AND** a span is recorded with status `401`
