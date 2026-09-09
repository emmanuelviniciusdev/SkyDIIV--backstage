# apps/robot-scrape-products/observability Specification

## Purpose

Export traces, metrics, and logs from the robot-scrape-products batch run to Grafana Cloud over OTLP without changing scrape, outbox, or self-delete behavior, and without coupling the batch to Grafana.

## Requirements

### Requirement: Batch-run telemetry is emitted

The robot MUST record a root span, run count/error/duration metrics, and structured logs for each process invocation (the weekly OCI batch). Resource attributes MUST include `service.name` `robot-scrape-products`. Span attributes MUST include compute provider and whether the run completed or failed. Telemetry attributes MUST NOT include listing HTML, proxy credentials, clothing images, or full outbox payloads.

#### Scenario: Successful batch is recorded

- **GIVEN** the robot boots with valid scrape configuration
- **WHEN** the batch runner finishes without a fatal error
- **THEN** search-term scraping and analyze outbox insert/publish behave as they do today
- **AND** a root span is recorded for the batch run with a success status
- **AND** a run-duration metric is recorded

#### Scenario: Fatal startup error is recorded

- **GIVEN** required env is missing so boot fails
- **WHEN** the process exits
- **THEN** the process exit code is non-zero
- **AND** an error log is emitted for the startup failure

### Requirement: Grafana Cloud OTLP export when configured

When `OBSERVABILITY_PROVIDER` is `grafana-cloud`, or when it is unset and OTLP endpoint plus headers are present, the robot MUST export traces, metrics, and logs over OTLP/HTTP to the configured Grafana Cloud gateway before process exit. Console NDJSON logs MUST still be emitted.

#### Scenario: Configured robot exports OTLP

- **GIVEN** `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` are set
- **AND** `OBSERVABILITY_PROVIDER` is unset or `grafana-cloud`
- **WHEN** the batch runner completes
- **THEN** traces, metrics, and logs are exported to that OTLP endpoint
- **AND** console NDJSON for the same run is still written

### Requirement: Missing backend does not change scrape behavior

When `OBSERVABILITY_PROVIDER` is `noop`, or when Grafana Cloud credentials are absent, the robot MUST still scrape, persist results, and enqueue analyze via the outbox. It MUST NOT call Grafana Cloud. Console NDJSON logs MUST still be emitted.

#### Scenario: Local robot without Grafana credentials

- **GIVEN** OTLP endpoint and headers are unset
- **WHEN** the batch runner runs
- **THEN** scrape and outbox behavior is unchanged
- **AND** no OTLP export is attempted
- **AND** console NDJSON is written

### Requirement: Export failure MUST NOT abort the batch

An OTLP export error MUST be logged and MUST NOT skip scrape persistence, analyze outbox insert/publish, or self-delete.

#### Scenario: Grafana Cloud is unreachable during flush

- **GIVEN** Grafana Cloud OTLP is configured
- **AND** the OTLP export fails at shutdown
- **WHEN** the batch runner has already persisted results
- **THEN** those result rows remain
- **AND** analyze outbox insert/publish still occurs
- **AND** the failure is logged
