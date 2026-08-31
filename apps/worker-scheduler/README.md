# worker-scheduler

Cloudflare Worker that acts as the **central scheduler** for SkyDIIV workflows. It exposes one signed HTTP endpoint per weekday; an external QStash schedule calls the endpoint, and the worker runs whatever flows are registered for that day.

Downstream work is delegated to [`worker-ai-workflows`](../worker-ai-workflows/README.md), which hosts the durable AI workflows. See each workflow's doc for full execution details:

- [generate-weekly-outfits](../worker-ai-workflows/docs/WEEKLY_OUTFITS_WORKFLOW.md)
- [generate-wardrobe-panorama](../worker-ai-workflows/docs/WARDROBE_PANORAMA_WORKFLOW.md)

Stale outbox events are re-enqueued via [`worker-outbox-events`](../worker-outbox-events/README.md):

- [catch-up-outbox-events](docs/CATCH_UP_OUTBOX_EVENTS.md)

---

## Endpoints

| Endpoint | Day | Registered flows |
|---|---|---|
| `POST /schedule/every-monday` | Monday | _(none)_ |
| `POST /schedule/every-tuesday` | Tuesday | _(none)_ |
| `POST /schedule/every-wednesday` | Wednesday | `neon-database-snapshot` |
| `POST /schedule/every-thursday` | Thursday | `generate-wardrobe-panorama` |
| `POST /schedule/every-friday` | Friday | `generate-search-terms-products-scraping` (automatic thrifting) |
| `POST /schedule/every-saturday` | Saturday | _(none)_ |
| `POST /schedule/every-sunday` | Sunday | `weekly-outfits` |
| `POST /schedule/catch-up-outbox-events` | — | `catch-up-outbox-events` |
| `POST /schedule/everyday` | — | _(none)_ |
| `GET /` | — | Health check → `{ status: "ok", timestamp }` |

Friday `generate-search-terms-products-scraping` runs after Thursday panorama and before the Friday 19:00 BRT `robot-scrape-products` window. It inserts one `generate-search-terms-products-scraping` outbox row per existing `wardrobe_panorama` and publishes `{ outboxEventId }` to `{WORKER_OUTBOX_EVENTS_URL}/process-outbox-event` (batches of 100). It does not publish directly to `worker-ai-workflows`.

Flow assignments come from `src/flows/registry.ts` and may change independently of this table.

### Request handling

Every `POST /schedule/every-<day>` request:

1. Verifies the QStash signature (`upstash-signature` header) — unsigned requests get `401`
2. Resolves all flows registered for that weekday
3. Runs them **in parallel** — one flow failing does not stop the others
4. Returns a JSON summary

| Situation | HTTP status | Response shape |
|---|---|---|
| No flows registered | `200` | `{ "day": "<weekday>", "flows": [] }` |
| All flows succeeded | `200` | `{ "day": "<weekday>", "flows": [{ "status": "ok", "flow": "...", ... }] }` |
| Some flows failed | `207` | Mix of `status: "ok"` and `status: "error"` entries |
| All flows failed | `500` | All entries have `status: "error"` |

`POST /schedule/catch-up-outbox-events` follows the same QStash auth rules but runs a single dedicated flow and returns `{ "status": "ok", "flow": "catch-up-outbox-events", "dispatched": <count> }` (or `500` on failure).

The CRON expression, timezone, and which endpoint QStash calls are configured entirely in Upstash — this worker only verifies the signature and runs the registered flows.

---

## Registered Flows

### `weekly-outfits`

**Registry:** `sunday` (at time of writing)  
**Source:** `src/flows/weekly-outfits.flow.ts`  
**Downstream:** `POST /generate-weekly-outfits` on `worker-ai-workflows`  
**Workflow doc:** [WEEKLY_OUTFITS_WORKFLOW.md](../worker-ai-workflows/docs/WEEKLY_OUTFITS_WORKFLOW.md)

1. Queries `weekly_outfit_preferences` for users with non-empty `location` and `routine_description`
2. Publishes one signed queue message per eligible user (`{ userId }`) to `{WORKER_AI_WORKFLOWS_URL}/generate-weekly-outfits`
3. Messages are batched in groups of 100

Returns `{ flow: "weekly-outfits", dispatched: <count> }`.

### `generate-wardrobe-panorama`

**Registry:** `thursday` (at time of writing)  
**Source:** `src/flows/generate-wardrobe-panorama.flow.ts`  
**Downstream:** `POST /generate-wardrobe-panorama` on `worker-ai-workflows`  
**Workflow doc:** [WARDROBE_PANORAMA_WORKFLOW.md](../worker-ai-workflows/docs/WARDROBE_PANORAMA_WORKFLOW.md)

1. Queries users with at least **10** clothing items in `clothing_items`
2. Keeps only users whose `wardrobe-update-check:{userId}--wardrobe-panorama` cache marker is present (set by the web app when the wardrobe changes)
3. Publishes one signed queue message per filtered user (`{ userId }`) to `{WORKER_AI_WORKFLOWS_URL}/generate-wardrobe-panorama`
4. Messages are batched in groups of 100

Returns `{ flow: "generate-wardrobe-panorama", dispatched: <count> }`.

> The downstream workflow still re-checks the cache marker at step 1 as a safety gate. Ad-hoc triggers that bypass the scheduler are also gated there.

### `neon-database-snapshot`

**Registry:** `wednesday` (at time of writing)  
**Source:** `src/flows/neon-database-snapshot.flow.ts`  
**Workflow doc:** [NEON_DATABASE_SNAPSHOT.md](docs/NEON_DATABASE_SNAPSHOT.md)

1. Lists existing manual snapshots via the Neon Management API
2. Deletes each snapshot (required on the Free plan, which allows only one manual snapshot)
3. Creates a new snapshot named `skydiiv-daily-YYYY-MM-DD` on the configured root branch

Returns `{ flow, deletedSnapshotIds, createdSnapshotId, createdSnapshotName }`.

### `catch-up-outbox-events`

**Endpoint:** `POST /schedule/catch-up-outbox-events`  
**Source:** `src/flows/catch-up-outbox-events.flow.ts`  
**Handler:** `src/handlers/catch-up-outbox-events.schedule.ts`  
**Downstream:** `POST /process-outbox-event` on `worker-outbox-events`  
**Workflow doc:** [CATCH_UP_OUTBOX_EVENTS.md](docs/CATCH_UP_OUTBOX_EVENTS.md)

1. Queries `outbox_events` for `PENDING` rows older than `OUTBOX_CATCHUP_MIN_AGE_MINUTES` (default **10**)
2. Publishes one signed queue message per stale event (`{ outboxEventId }`) to `{WORKER_OUTBOX_EVENTS_URL}/process-outbox-event`
3. Messages are batched in groups of 100

Returns `{ status: "ok", flow: "catch-up-outbox-events", dispatched: <count> }`.

> Create a QStash schedule pointing at `/schedule/catch-up-outbox-events` with the desired catch-up frequency (for example every 30 minutes).

### Everyday flows (`POST /schedule/everyday`)

**Handler:** `src/handlers/everyday.schedule.ts`  
**Registry:** `src/flows/everyday-registry.ts`  
**Workflow doc:** [EVERYDAY_SCHEDULE.md](docs/EVERYDAY_SCHEDULE.md)

Runs all flows registered in `everyday-registry.ts` **in parallel**. One flow failing does not stop the others. Currently no flows are registered.

> Create a QStash schedule pointing at `/schedule/everyday` with a daily CRON (for example `0 6 * * *` UTC).

---

## Services & Technologies

| Layer | Technology | Role |
|---|---|---|
| Runtime | [Cloudflare Workers](https://developers.cloudflare.com/workers/) (`nodejs_compat`) | Hosts this worker |
| Language | TypeScript 5 (strict) | Implementation |
| Scheduling trigger | [Upstash QStash](https://upstash.com/docs/qstash) (external CRON) | Fires weekday endpoints on a configured schedule |
| Message publishing | [Upstash QStash](https://upstash.com/docs/qstash) (`@upstash/qstash`) | Dispatches per-user messages to `worker-ai-workflows`; re-enqueues stale outbox events to `worker-outbox-events` |
| Database | [Neon](https://neon.tech) PostgreSQL via [postgres.js](https://github.com/porsager/postgres) | Read-only queries for eligible users and stale outbox events |
| Backups | [Neon Management API](https://neon.com/docs/reference/api-reference) | `neon-database-snapshot` flow (registered on `/schedule/every-wednesday`) |
| Cache | [Upstash Redis](https://upstash.com/docs/redis) (REST API) | Wardrobe panorama flow — filter users by update marker |
| Dev / deploy | Wrangler 4 | Local dev and Cloudflare deployment |
| Testing | Vitest 4 | Unit tests |
| Linting | ESLint 10 + typescript-eslint | Code quality |
| CI/CD | GitHub Actions | Lint, test, deploy on push to `main` / `staging` |

---

## Project Structure

```
├── src/
│   ├── index.ts                            # Worker entry; health check + routing
│   ├── scheduler.ts                        # Weekday handler — verify → resolve → run in parallel
│   ├── handlers/
│   │   ├── catch-up-outbox-events.schedule.ts  # Dedicated catch-up endpoint handler
│   │   └── everyday.schedule.ts                # Everyday endpoint handler
│   ├── flows/
│   │   ├── types.ts                        # Weekday, ScheduleFlow, FlowResult
│   │   ├── registry.ts                     # Maps weekday → flows
│   │   ├── everyday-registry.ts            # Flows for POST /schedule/everyday
│   │   ├── weekly-outfits.flow.ts
│   │   ├── generate-wardrobe-panorama.flow.ts
│   │   ├── catch-up-outbox-events.flow.ts
│   │   └── neon-database-snapshot.flow.ts
│   └── lib/
│       ├── logger.ts
│       ├── qstash.ts                       # QStash client + receiver
│       ├── outbox-catchup-config.ts        # OUTBOX_CATCHUP_MIN_AGE_MINUTES parser
│       ├── worker-outbox-events-url.ts     # WORKER_OUTBOX_EVENTS_URL resolver
│       ├── neon/
│       │   ├── config.ts                   # NEON_* env resolver
│       │   └── snapshots.ts                # Neon snapshot API client
│       ├── cache/
│       │   ├── redis.ts                    # Upstash Redis REST helpers
│       │   └── wardrobe-panorama-cache.ts  # Update-marker filter for panorama flow
│       └── db/
│           ├── client.ts
│           ├── users.repository.ts
│           └── outbox-events.repository.ts
├── docs/
│   ├── CATCH_UP_OUTBOX_EVENTS.md
│   ├── EVERYDAY_SCHEDULE.md
│   └── NEON_DATABASE_SNAPSHOT.md
├── tests/unit/
├── wrangler.toml
├── .env.example                            # Copy to .dev.vars for local dev
└── package.json
```

---

## Adding a New Scheduled Job

1. Create a flow implementing `ScheduleFlow` in `src/flows/`:

```ts
import type { FlowResult, ScheduleFlow } from "./types"

export const myFlow: ScheduleFlow = {
  name: "my-flow",
  async run(): Promise<FlowResult> {
    // query DB, publish messages, etc.
    return { flow: "my-flow", dispatched: 0 }
  },
}
```

2. Register it for a weekday in `src/flows/registry.ts`:

```ts
export const flowRegistry: Partial<Record<Weekday, ScheduleFlow[]>> = {
  sunday: [weeklyOutfitsFlow],
  monday: [myFlow],
}
```

Multiple flows can share a day — they run in parallel.

For daily jobs, implement a `ScheduleFlow` and append it to `everydayFlowRegistry` in `src/flows/everyday-registry.ts` (see [EVERYDAY_SCHEDULE.md](docs/EVERYDAY_SCHEDULE.md)).

3. Create a QStash schedule pointing at the appropriate endpoint:

```
https://worker-scheduler.<subdomain>.workers.dev/schedule/every-<day>
https://worker-scheduler.<subdomain>.workers.dev/schedule/catch-up-outbox-events
https://worker-scheduler.<subdomain>.workers.dev/schedule/everyday
```

No changes to `src/index.ts` are required for weekday or everyday jobs.

---

## Security

- No end-user authentication — internal automation only
- All schedule requests must be signed by QStash; unsigned or invalid signatures get `401`
- `GET /` is the only unsigned endpoint (health check)
- Secrets (`DATABASE_URL`, `QSTASH_*`, worker URLs, `NEON_*`) are Cloudflare Worker secrets — never in source control

---

## Getting Started

### Prerequisites

- Node.js 22+
- Wrangler 4
- Cloudflare Workers account
- Upstash QStash account (signing keys + publish token)
- Upstash Redis (shared with the SkyDIIV web app; required for the wardrobe panorama flow)
- Neon PostgreSQL database (shared with the SkyDIIV web app)
- Deployed `worker-ai-workflows` endpoints for any active flows

### Local Development

```bash
npm install
cp .env.example .dev.vars   # fill in secrets
npm run dev                 # http://localhost:8787
```

Schedule endpoints require a valid QStash signature. For end-to-end testing, use `wrangler dev` with a tunnel and trigger from the Upstash console or CLI.

### Tests & Lint

```bash
npm test
npm run test:watch
npm run test:coverage
npm run lint
npm run lint:fix
```

---

## Configuration

### `wrangler.toml`

| Setting | Value |
|---|---|
| Worker name (production) | `worker-scheduler` |
| Worker name (staging) | `worker-scheduler-staging` |
| Entry point | `src/index.ts` |
| Compatibility date | `2025-01-01` |
| Compatibility flags | `nodejs_compat` |

### Secrets

Set via `wrangler secret put <KEY>` in production, or `.dev.vars` locally. See `.env.example` for the full list.

| Secret | Used by |
|---|---|
| `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | All schedule endpoints (signature verification) |
| `QSTASH_URL`, `QSTASH_TOKEN` | Flows that publish messages |
| `DATABASE_URL` | All flows (eligible-user queries) |
| `WORKER_AI_WORKFLOWS_URL` | `weekly-outfits` and `generate-wardrobe-panorama` flows |
| `WORKER_OUTBOX_EVENTS_URL` | `catch-up-outbox-events` flow |
| `OUTBOX_CATCHUP_MIN_AGE_MINUTES` | `catch-up-outbox-events` flow (optional; default `10`) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or `REDIS_URL`) | `generate-wardrobe-panorama` flow (update-marker filter) |
| `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_BRANCH_ID` | `neon-database-snapshot` flow |

`WORKER_AI_WORKFLOWS_URL` is the worker-ai-workflows origin only (no path). Each flow appends its endpoint:

```
{WORKER_AI_WORKFLOWS_URL}/generate-weekly-outfits
{WORKER_AI_WORKFLOWS_URL}/generate-wardrobe-panorama
{WORKER_OUTBOX_EVENTS_URL}/process-outbox-event
```

### External schedules

After deploying, create QStash schedules in the [Upstash Console](https://console.upstash.com/qstash):

```
https://worker-scheduler.<subdomain>.workers.dev/schedule/every-<day>
https://worker-scheduler.<subdomain>.workers.dev/schedule/catch-up-outbox-events
https://worker-scheduler.<subdomain>.workers.dev/schedule/everyday
```

When and how often each endpoint fires is configured in Upstash, not in this repository.

---

## Deployment

CI runs lint + test on PRs; deploys on push to `staging` or `main` when files under `apps/worker-scheduler/` change (`.github/workflows/deploy-worker-scheduler.yml`).

```bash
npm run deploy                  # production
npm run deploy -- --env staging # staging
```

### GitHub Secrets (deploy)

| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers deploy permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `DATABASE_URL` | Neon pooled connection string |
| `QSTASH_TOKEN` | QStash API token |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash current signing key |
| `QSTASH_NEXT_SIGNING_KEY` | QStash next signing key |
| `WORKER_AI_WORKFLOWS_URL` | worker-ai-workflows origin (no path) |
| `WORKER_OUTBOX_EVENTS_URL` | worker-outbox-events origin (no path) |
| `OUTBOX_CATCHUP_MIN_AGE_MINUTES` | Minimum age in minutes before a PENDING outbox event is re-enqueued (optional; default `10`) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL (wardrobe panorama cache filter) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `NEON_API_KEY` | Neon Management API key (weekly snapshot flow) |
| `NEON_PROJECT_ID` | Neon project ID |
| `NEON_BRANCH_ID` | Neon root branch ID to snapshot |
