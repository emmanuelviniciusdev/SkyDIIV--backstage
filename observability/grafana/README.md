# Grafana Cloud dashboards

Git is the source of truth for the SkyDIIV backstage dashboards. If you tweak a panel in the Grafana UI, the next deploy overwrites it — change the JSON here instead.

Everything lands in the **SkyDIIV** folder.

## SkyDIIV — Overview

`dashboards/overview.json` · uid `skydiiv-bs-overview`

Answers "is backstage healthy right now?" across all the workers plus the scraping robot, without needing to know which app does what. Defaults to the last 24 hours and refreshes every minute. An **Environment** picker at the top switches between `production`, `staging`, and `local`; every panel is filtered by it.

### Workers

These four panels cover `worker-ai-workflows`, `worker-scheduler`, `worker-outbox-events`, `worker-notification`, and `worker-sync`, each broken out as its own series so you can tell which app is misbehaving.

- **Request volume** — how many HTTP requests each worker handled, from `http_server_request_count`. This is your baseline: a worker that normally sits at a steady line and suddenly drops to zero has either stopped being triggered or stopped responding.
- **Error count (status 4xx/5xx)** — the same count filtered to `http_response_status_code=~"4..|5.."`. In practice 4xx here is usually a rejected QStash signature and 5xx is the worker itself failing, so a spike on one worker is the first place to look.
- **p95 duration** — 95th percentile of `http_server_request_duration`, in milliseconds. Catches the slow tail that an average hides, which matters most for the AI workflows worker.
- **Health (GET /) vs work** — splits request volume into `http_route="/"` and everything else. Health checks are cheap and constant; real work is the QStash-signed POSTs. Seeing both on one panel tells you whether a quiet worker is actually down or just not being asked to do anything.

### Robot scrape products

- **Batch runs** — `batch_run_count` for `robot-scrape-products`, grouped by `batch_status`. While a scrape is in progress you should see `running`; when it finishes, `success` or `error`. The weekly job is a pulse, not a continuous worker line.
- **Batch duration** — average `batch_run_duration` in milliseconds. A steadily climbing line usually means the catalogue is growing or the upstream site got slower, not that the robot broke.

## SkyDIIV — Images Uploads

`dashboards/image-uploads.json` · uid `skydiiv-bs-image-uploads`

User-facing image uploads from `skydiiv-web` (`/api/*` RED metrics). Same environment picker and `_over_time` queries as overview. Direct PUTs to R2 are not in these series — only the Next.js routes around them.

### Upload pipeline (R2)

Presign (`POST /api/upload/presign`) and stamp-owner (`POST /api/upload/stamp-owner`) are shared by clothing pieces, profile pictures, and outfit (creative-board) uploads. `purpose` is not a metric label, so those two routes cannot be split by kind.

- **Presigns (2xx)** / **Files landed (stamp-owner 2xx)** — range totals. A gap means the browser got a signed URL but never finished the R2 PUT (or stamp-owner failed).
- **Presign vs stamp-owner volume** — the same funnel over time.
- **Pipeline errors** — 4xx/5xx on those two routes.
- **Pipeline p95 duration** — slow presign usually means R2 signing; slow stamp-owner is metadata copy on the object.
- **Presign status codes** — 401 unauthenticated, 403 access key, 400 unsupported type or invalid input, 5xx R2/presign failure.

### Clothing pieces

- **Pieces saved** — `POST /api/pieces/classify` 2xx vs 4xx vs 5xx. A 2xx is a clothing item written to the database after the user classifies the image. This is the piece-specific success signal; it is not mixed with outfit or profile uploads.
- **Classify p95 duration** — classification + Prisma write.

### Profile pictures

- **Profile pictures saved (PUT 2xx)** — range total after presign + R2 PUT + persist.
- **Saved vs removed** — `PUT` vs `DELETE` on `/api/user/profile-picture`.
- **Errors** and **p95** split by method.

## Writing queries

Our OTLP metrics arrive as **gauges** — each request emits a count of 1 plus a duration in milliseconds. Prometheus `rate()` gives wrong answers on those series, so use the `_over_time` family:

| You want | Query |
|---|---|
| Volume | `count_over_time(http_server_request_count{...}[$__interval])` |
| Average latency | `avg_over_time(http_server_request_duration{...}[$__interval])` |
| p95 latency | `quantile_over_time(0.95, http_server_request_duration{...}[$__interval])` |
| Errors | the volume query plus `http_response_status_code=~"4..\|5.."` |
| Robot batches | `batch_run_count` / `batch_run_duration`, split by `batch_status` |

Labels available: `service_name`, `deployment_environment`, `http_route`, `http_request_method`, `http_response_status_code`.

Panels reference `DS_PROMETHEUS` instead of a real datasource id; deploy swaps in the actual UID so the same JSON works against any stack.

Never query email addresses, LLM prompts, or raw QStash payloads.

## Working locally

```bash
cd observability/grafana
npm ci
npm run lint
npm test
npm run validate
```

`npm run validate` is offline — it checks structure and never talks to Grafana Cloud. To push to a stack yourself:

```bash
export GRAFANA_URL="https://<stack>.grafana.net"
export GRAFANA_SERVICE_ACCOUNT_TOKEN="..."
npm run deploy
```

Keep those out of `wrangler.toml`, `.dev.vars`, and git.

## CI

`.github/workflows/deploy-grafana-dashboards.yml` validates on pull requests that touch this directory, and upserts on pushes to `staging` and `main`. Both the `staging` and `production` GitHub Environments need `GRAFANA_URL` and a `GRAFANA_SERVICE_ACCOUNT_TOKEN` with `dashboards:write`, `folders:write`, and `datasources:read`. These are separate from the OTLP write credentials the workers use, and a missing one fails only this job.

Deploy upserts by uid and never deletes, so a dashboard removed from git stays in Grafana until someone deletes it there.
