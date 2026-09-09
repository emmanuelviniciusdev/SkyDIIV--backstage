## 1. worker-ai-workflows — port, adapters, factory

- [x] 1.1 Add `src/domain/ports/logger.port.ts` and `src/domain/ports/observability.port.ts` (span handle, `recordMetric`, `logger`, `flush`, `shutdown`); move the `Logger` interface out of `src/lib/logger.ts` and re-export it so existing imports still typecheck
- [x] 1.2 Add `src/infrastructure/observability/providers/noop.provider.ts` and `providers/grafana-cloud.otlp.provider.ts` (OTLP/HTTP JSON via `fetch` to `{endpoint}/v1/traces|metrics|logs`, dual-write NDJSON + OTLP logs, swallow export errors); add `observability.factory.ts` with `grafana-cloud` | `noop` | auto-detect matching design.md; verify unit tests cover explicit ids, auto-detect, incomplete grafana-cloud → noop, unknown id throws, Grafana POST URLs/headers, and that a rejected `fetch` does not throw from `flush`
- [x] 1.3 Add ALS-backed `src/lib/logger.ts` facade and `with-request-telemetry.ts` (root span, `http.server.request.count` / `duration`, `ctx.waitUntil(flush)`); wrap `src/index.ts` `fetch(request, env, ctx)` after `Object.assign(process.env, env)` without changing `serveMany` routing; verify `tests/unit/index.test.ts` still returns `200` on `GET /` and `401` when the workflow router rejects unsigned POSTs, and that telemetry tests assert those statuses are recorded even when `flush` rejects

## 2. worker-ai-workflows — env, CI, docs, quality

- [x] 2.1 Document `OBSERVABILITY_PROVIDER`, `OTEL_SERVICE_NAME`, `DEPLOYMENT_ENVIRONMENT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_EXPORTER_OTLP_HEADERS` in `.env.example` and wrangler.toml comments; set `DEPLOYMENT_ENVIRONMENT` in `[vars]` (`production`) and `[env.staging.vars]` (`staging`); add the two OTEL keys to both `wrangler secret bulk` lists in `.github/workflows/deploy-worker-ai-workflows.yml`
- [x] 2.2 Add `docs/OBSERVABILITY.md` (port vs Grafana adapter, factory table, secrets vs `[vars]`, origin-only worker URL unchanged, PII rules) and link it from `README.md`; run `npm run lint` and `npm run test` in `apps/worker-ai-workflows` and verify both succeed

## 3. worker-scheduler

- [x] 3.1 Copy the worker-ai-workflows observability port, noop + Grafana adapters, factory, ALS logger, and `with-request-telemetry` into `apps/worker-scheduler` with `service.name` `worker-scheduler`; wrap `src/index.ts` the same way; verify unit tests for factory/adapter/`GET /` `200` and unsigned `POST /schedule/every-friday` still `401` with a recorded span
- [x] 3.2 Mirror env, wrangler `[vars]`, and secret-bulk keys from task 2.1 in worker-scheduler `.env.example`, `wrangler.toml`, and `.github/workflows/deploy-worker-scheduler.yml`; add `docs/OBSERVABILITY.md` + README link; run `npm run lint` and `npm run test` in `apps/worker-scheduler` and verify both succeed

## 4. worker-outbox-events

- [x] 4.1 Copy the same observability stack into `apps/worker-outbox-events` (`service.name` `worker-outbox-events`); wrap `src/index.ts`; verify factory/adapter tests plus `GET /` `200` and unsigned `POST /process-outbox-event` still `401` with a recorded span
- [x] 4.2 Mirror env, wrangler `[vars]`, and secret-bulk keys in worker-outbox-events `.env.example`, `wrangler.toml`, and `.github/workflows/deploy-worker-outbox-events.yml`; add `docs/OBSERVABILITY.md` + README link; run `npm run lint` and `npm run test` in `apps/worker-outbox-events` and verify both succeed

## 5. worker-notification

- [x] 5.1 Copy the same observability stack into `apps/worker-notification` (`service.name` `worker-notification`); wrap `src/index.ts`; verify factory/adapter tests plus `GET /` `200` and unsigned `POST /email--welcome` still `401` with a recorded span (no email side effects)
- [x] 5.2 Mirror env, wrangler `[vars]`, and secret-bulk keys in worker-notification `.env.example`, `wrangler.toml`, and `.github/workflows/deploy-worker-notification.yml`; add `docs/OBSERVABILITY.md` + README link; run `npm run lint` and `npm run test` in `apps/worker-notification` and verify both succeed

## 6. worker-sync

- [x] 6.1 Copy the same observability stack into `apps/worker-sync` (`service.name` `worker-sync`); wrap `src/index.ts`; verify factory/adapter tests plus `GET /` `200` and unsigned `POST /sync/language` still `401` with a recorded span
- [x] 6.2 Mirror env, wrangler `[vars]`, and secret-bulk keys in worker-sync `.env.example`, `wrangler.toml`, and `.github/workflows/deploy-worker-sync.yml`; add `docs/OBSERVABILITY.md` + README link; run `npm run lint` and `npm run test` in `apps/worker-sync` and verify both succeed

## 7. robot-scrape-products

- [x] 7.1 Add `domain/ports/observability.port.ts` and the same factory + noop/Grafana providers under `infrastructure/observability/` (reuse existing `Logger` port); wire `main.ts` to create the provider after `loadConfig`, start a root span around `runner.start()`, and `shutdown` in `finally` and signal handlers; verify unit tests cover factory selection, Grafana POSTs, and that a rejected flush after a successful runner mock still leaves scrape/outbox behavior unchanged
- [x] 7.2 Extend `infrastructure/config/env.ts` with optional `OBSERVABILITY_PROVIDER`, `OTEL_SERVICE_NAME`, `DEPLOYMENT_ENVIRONMENT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_EXPORTER_OTLP_HEADERS` (missing OTLP keys remain valid); document them in `.env.example`, `docs/ENV.md` (`ROBOT_SCRAPE_PRODUCTS_ENV`), and new `docs/OBSERVABILITY.md` linked from `README.md`; run `npm run lint` and `npm run test` in `apps/robot-scrape-products` and verify both succeed
