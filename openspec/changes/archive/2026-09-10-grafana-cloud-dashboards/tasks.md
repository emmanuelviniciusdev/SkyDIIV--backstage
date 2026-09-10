## 1. observability/grafana — project scaffold

- [x] 1.1 Create `observability/grafana/` as an independent Node 22 project (`package.json` with `validate`, `deploy`, `test`, and `lint` scripts; Vitest; no Wrangler) matching design.md layout (`dashboards/`, `src/`, `tests/`) and verify `npm ci` succeeds in that directory
- [x] 1.2 Add `src/validate.mjs` that loads every `dashboards/*.json`, asserts parseable JSON, required `uid`s (`skydiiv-bs-overview`, `skydiiv-bs-schedules`, `skydiiv-bs-service-red`), tags, and `environment` templating, rejects `skydiiv-bs-web-interactions` / a `web-backstage-interactions` file, and verify `npm run validate` fails on missing uid and passes on a well-formed stub set

## 2. observability/grafana — dashboards

- [x] 2.1 Add `dashboards/overview.json` (`uid` `skydiiv-bs-overview`) with per-service volume / error / p95 panels for the six backstage services, health (`http_route="/"`) vs work split, robot `batch_run_*` success vs error, `$environment` variable, and `_over_time` PromQL (not `rate()`); verify `npm run validate` includes this file, tests assert each `service_name` appears in panel targets, and PII denylist terms (`email`, `prompt`, `payload`) are absent from queries
- [x] 2.2 Add `dashboards/scheduled-pipelines.json` (`uid` `skydiiv-bs-schedules`) covering `/schedule/every-sunday` through `/schedule/every-saturday`, `/schedule/everyday`, the four `worker-ai-workflows` routes, and robot batch success vs error; verify tests assert those route strings are present
- [x] 2.3 Add `dashboards/service-red.json` (`uid` `skydiiv-bs-service-red`) with `$service` (six names) and `$environment` variables, request-or-batch volume, status breakdown, duration, Loki error logs, and a Tempo traces entry; verify tests assert both variables exist and Loki/Tempo placeholder datasource ids `DS_LOKI` / `DS_TEMPO` are referenced

## 3. observability/grafana — deploy tool

- [x] 3.1 Implement `src/datasources.mjs` to `GET /api/datasources` with Bearer token and pick Prometheus / Loki / Tempo UIDs per design.md preference rules; verify unit tests cover grafanacloud-name preference, failure when a type is missing, and that no Grafana call happens in `validate`
- [x] 3.2 Implement `src/deploy.mjs` to require `GRAFANA_URL` and `GRAFANA_SERVICE_ACCOUNT_TOKEN`, ensure folder `skydiiv-backstage` / title `SkyDIIV Backstage` (GET then POST on 404), substitute datasource placeholders, strip dashboard `id`, and `POST /api/dashboards/db` with `overwrite: true`; verify mocked-fetch tests cover first deploy, idempotent second deploy (same `uid`, overwrite), missing credentials throw, and Grafana 4xx/5xx fail the process

## 4. observability/grafana — quality

- [x] 4.1 Run `npm run lint` and `npm run test` in `observability/grafana` and verify both succeed (Vitest only; no Playwright)

## 5. GitHub Actions pipeline

- [x] 5.1 Add `.github/workflows/deploy-grafana-dashboards.yml` with path filters on `observability/grafana/**` and the workflow file, PR `validate` job (`npm ci` / `npm test` / `npm run validate`, no Grafana secrets), and `staging`/`main` push plus `workflow_dispatch` `deploy` job that needs validate and uses GitHub Environment secrets `GRAFANA_URL` and `GRAFANA_SERVICE_ACCOUNT_TOKEN`; verify the YAML concurrency group is `grafana-dashboards-${{ github.ref }}`, deploy does not invoke wrangler or worker workflows, and PR jobs do not reference Grafana secrets

## 6. Documentation

- [x] 6.1 Write `observability/grafana/README.md` covering the three dashboards, gauge `_over_time` queries, folder/uids, GitHub Environment secrets vs OTLP worker secrets, local `npm run validate` / `npm run deploy`, and “git is source of truth”; verify the README names `GRAFANA_URL` and `GRAFANA_SERVICE_ACCOUNT_TOKEN` and does not instruct operators to put tokens in wrangler.toml
- [x] 6.2 Add a short Dashboards section to each app `docs/OBSERVABILITY.md` (`worker-ai-workflows`, `worker-scheduler`, `worker-outbox-events`, `worker-notification`, `worker-sync`, `robot-scrape-products`) linking to `observability/grafana/README.md`; verify each file contains that relative link
