# observability/grafana Specification

## Purpose

Give operators version-controlled Grafana Cloud dashboards that show backstage RED metrics and scheduled pipelines (weekday CRON, AI workflows, robot batch), and deploy those dashboards automatically from git.

## Requirements

### Requirement: Dashboard definitions live in the backstage repo

The repository MUST keep Grafana dashboard definitions under `observability/grafana/`. Each dashboard MUST have a stable unique identifier that does not change across deploys. The set MUST include at least:

- a platform overview of all backstage services
- a scheduled-pipelines view
- a per-service RED view that can be filtered by service name and deployment environment

The set MUST NOT include a dedicated web ↔ backstage interactions dashboard.

#### Scenario: Operators find dashboard sources in-repo

- **GIVEN** the change is applied
- **WHEN** an operator opens `observability/grafana/`
- **THEN** dashboard definitions for overview, scheduled pipelines, and per-service RED are present
- **AND** each definition includes a stable unique identifier
- **AND** no dashboard is dedicated to web ↔ backstage outbox, welcome-email, or language-sync hops

### Requirement: Overview dashboard shows backstage RED by service

The overview dashboard MUST display request volume, error rate (HTTP status ≥ 400), and latency for:

- `worker-ai-workflows`
- `worker-scheduler`
- `worker-outbox-events`
- `worker-notification`
- `worker-sync`
- `robot-scrape-products`

Worker panels MUST use the existing `http.server.request.count` and `http.server.request.duration` telemetry (and traces/logs derived from the same requests). Robot panels MUST use `batch.run.count` and `batch.run.duration`. Panels MUST be filterable by `deployment.environment` (`staging` | `production` | `local`).

#### Scenario: Operator filters production overview

- **GIVEN** Grafana Cloud contains OTLP telemetry from backstage apps
- **AND** the overview dashboard is loaded
- **WHEN** the operator selects environment `production`
- **THEN** request volume, error rate, and latency are shown per service for that environment
- **AND** health-check traffic (`GET /`) is distinguishable from signed work traffic

### Requirement: Scheduled-pipelines dashboard covers CRON and robot work

The scheduled-pipelines dashboard MUST show volume, errors, and latency for:

- `worker-scheduler` weekday routes `/schedule/every-sunday` through `/schedule/every-saturday` and `/schedule/everyday`
- `worker-ai-workflows` routes `/generate-weekly-outfits`, `/generate-wardrobe-panorama`, `/generate-search-terms-products-scraping`, and `/analyze-scraped-products-results`
- `robot-scrape-products` batch runs (`batch.run.*`)

#### Scenario: Sunday outfits pipeline is visible

- **GIVEN** telemetry exists for `POST` `/schedule/every-sunday` and `POST` `/generate-weekly-outfits`
- **WHEN** the operator opens the scheduled-pipelines dashboard
- **THEN** both routes are plotted
- **AND** robot batch success vs error is visible independently of worker HTTP

### Requirement: Per-service RED dashboard is parameterized

The per-service RED dashboard MUST accept a service-name variable whose values are the six backstage service names and an environment variable. Changing the service MUST update request (or batch) volume, status breakdown, latency percentiles, recent error logs, and a traces entry point for that service.

#### Scenario: Operator drills into worker-scheduler

- **GIVEN** the per-service dashboard is open
- **WHEN** the operator selects service `worker-scheduler` and environment `production`
- **THEN** panels show that service's request count, status codes, and duration
- **AND** logs and traces for that service in that environment are reachable from the dashboard

### Requirement: Dashboards MUST NOT expose PII

Dashboard queries and panel titles MUST NOT request or display email addresses, clothing images, LLM prompt bodies, proxy URLs, listing HTML, or raw QStash JSON payloads. `userId` MAY appear only if it is already present on existing telemetry attributes.

#### Scenario: Panel queries stay within allowed attributes

- **GIVEN** the dashboard definitions are validated
- **WHEN** an operator inspects panel queries
- **THEN** no query selects email, prompt text, image bytes, or full QStash payload fields

### Requirement: CI validates dashboard definitions without calling Grafana Cloud

On a pull request that changes `observability/grafana/` or the deploy workflow, CI MUST validate that every dashboard definition is well-formed JSON (or the chosen dashboard format), has a stable unique identifier, and references the required panel coverage above. That pull-request job MUST NOT call Grafana Cloud.

#### Scenario: Pull request with a broken dashboard fails CI

- **GIVEN** a pull request that adds a dashboard file with invalid JSON or a missing unique identifier
- **WHEN** CI runs
- **THEN** the validation job fails
- **AND** Grafana Cloud is not contacted

#### Scenario: Unrelated pull request does not deploy dashboards

- **GIVEN** a pull request that does not touch `observability/grafana/` or the Grafana deploy workflow
- **WHEN** CI runs
- **THEN** the Grafana dashboard deploy job does not run against Grafana Cloud

### Requirement: Push deploys dashboards to Grafana Cloud

When `observability/grafana/` or the Grafana deploy workflow changes on `staging` or `main` (or an operator runs the workflow manually on those branches), CI MUST upsert every dashboard into the Grafana Cloud stack configured for that GitHub Environment. Upsert MUST be keyed by the dashboard unique identifier so a second deploy of the same git tree does not create duplicate dashboards. Dashboards MUST land in a dedicated Grafana folder for SkyDIIV backstage. Datasource references MUST be resolved against that stack (Prometheus-compatible metrics, Loki logs, Tempo traces) rather than hard-coding another stack's datasource ids.

Missing `GRAFANA_URL` or `GRAFANA_SERVICE_ACCOUNT_TOKEN` MUST fail the deploy job. A Grafana API error MUST fail the job. Deploy MUST NOT deploy, restart, or reconfigure any Cloudflare Worker or the robot.

#### Scenario: First production deploy creates the folder and dashboards

- **GIVEN** GitHub Environment `production` has Grafana URL and service-account token
- **AND** the dashboards do not yet exist in that Grafana Cloud stack
- **WHEN** the workflow runs on `main`
- **THEN** a SkyDIIV backstage folder exists in Grafana
- **AND** each dashboard in `observability/grafana/` is present with its stable unique identifier

#### Scenario: Second deploy is idempotent

- **GIVEN** the dashboards were already deployed from the same definitions
- **WHEN** the workflow runs again against the same Grafana Cloud stack
- **THEN** each unique identifier still maps to exactly one dashboard
- **AND** panel queries match the definitions in git

#### Scenario: Missing Grafana credentials fail deploy only

- **GIVEN** `GRAFANA_URL` or `GRAFANA_SERVICE_ACCOUNT_TOKEN` is unset in the target GitHub Environment
- **WHEN** a dashboard deploy is attempted
- **THEN** the deploy job fails
- **AND** no worker or robot deploy is triggered by that failure

#### Scenario: Staging and production stacks are independent

- **GIVEN** GitHub Environments `staging` and `production` each have Grafana credentials
- **WHEN** the workflow runs on `staging` versus `main`
- **THEN** dashboards are upserted using that environment's Grafana URL and token
- **AND** worker HTTP contracts, QStash signatures, and outbox routes are unchanged
