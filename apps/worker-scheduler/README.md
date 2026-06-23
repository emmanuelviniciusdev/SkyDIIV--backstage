# worker-scheduler

Cloudflare Worker that acts as the **central scheduler** for SkyDIIV workflows. It exposes one signed HTTP endpoint per weekday; an external QStash schedule calls the endpoint, and the worker runs whatever flows are registered for that day.

Downstream work is delegated to [`worker-ai-workflows`](../worker-ai-workflows/README.md), which hosts the durable AI workflows. See each workflow's doc for full execution details:

- [generate-weekly-outfits](../worker-ai-workflows/docs/WEEKLY_OUTFITS_WORKFLOW.md)
- [generate-wardrobe-panorama](../worker-ai-workflows/docs/WARDROBE_PANORAMA_WORKFLOW.md)

---

## Endpoints

| Endpoint | Day | Registered flows |
|---|---|---|
| `POST /schedule/every-monday` | Monday | _(none)_ |
| `POST /schedule/every-tuesday` | Tuesday | _(none)_ |
| `POST /schedule/every-wednesday` | Wednesday | _(none)_ |
| `POST /schedule/every-thursday` | Thursday | `generate-wardrobe-panorama` |
| `POST /schedule/every-friday` | Friday | _(none)_ |
| `POST /schedule/every-saturday` | Saturday | _(none)_ |
| `POST /schedule/every-sunday` | Sunday | `weekly-outfits` |
| `GET /` | — | Health check → `{ status: "ok", timestamp }` |

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

The CRON expression, timezone, and which weekday endpoint QStash calls are configured entirely in Upstash — this worker only verifies the signature and runs the registered flows.

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

---

## Services & Technologies

| Layer | Technology | Role |
|---|---|---|
| Runtime | [Cloudflare Workers](https://developers.cloudflare.com/workers/) (`nodejs_compat`) | Hosts this worker |
| Language | TypeScript 5 (strict) | Implementation |
| Scheduling trigger | [Upstash QStash](https://upstash.com/docs/qstash) (external CRON) | Fires weekday endpoints on a configured schedule |
| Message publishing | [Upstash QStash](https://upstash.com/docs/qstash) (`@upstash/qstash`) | Dispatches per-user messages to `worker-ai-workflows` |
| Database | [Neon](https://neon.tech) PostgreSQL via [postgres.js](https://github.com/porsager/postgres) | Read-only queries for eligible users |
| Cache | [Upstash Redis](https://upstash.com/docs/redis) (REST API) | Wardrobe panorama flow — filter users by update marker |
| Dev / deploy | Wrangler 4 | Local dev and Cloudflare deployment |
| Testing | Vitest 4 | Unit tests |
| Linting | ESLint 10 + typescript-eslint | Code quality |
| CI/CD | GitHub Actions | Lint, test, deploy on push to `main` / `staging` |

---

## Project Structure

```
├── src/
│   ├── index.ts                            # Worker entry; health check + weekday routing
│   ├── scheduler.ts                        # Verify signature → resolve flows → run in parallel
│   ├── flows/
│   │   ├── types.ts                        # Weekday, ScheduleFlow, FlowResult
│   │   ├── registry.ts                     # Maps weekday → flows
│   │   ├── weekly-outfits.flow.ts
│   │   └── generate-wardrobe-panorama.flow.ts
│   └── lib/
│       ├── logger.ts
│       ├── qstash.ts                       # QStash client + receiver
│       ├── cache/
│       │   ├── redis.ts                    # Upstash Redis REST helpers
│       │   └── wardrobe-panorama-cache.ts  # Update-marker filter for panorama flow
│       └── db/
│           ├── client.ts
│           └── users.repository.ts
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

3. Create a QStash schedule pointing at `https://worker-scheduler.<subdomain>.workers.dev/schedule/every-<day>`.

No changes to `src/index.ts` are required.

---

## Security

- No end-user authentication — internal automation only
- All schedule requests must be signed by QStash; unsigned or invalid signatures get `401`
- `GET /` is the only unsigned endpoint (health check)
- Secrets (`DATABASE_URL`, `QSTASH_*`, worker URLs) are Cloudflare Worker secrets — never in source control

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
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or `REDIS_URL`) | `generate-wardrobe-panorama` flow (update-marker filter) |

`WORKER_AI_WORKFLOWS_URL` is the worker-ai-workflows origin only (no path). Each flow appends its endpoint:

```
{WORKER_AI_WORKFLOWS_URL}/generate-weekly-outfits
{WORKER_AI_WORKFLOWS_URL}/generate-wardrobe-panorama
```

### External schedules

After deploying, create one QStash schedule per active weekday endpoint in the [Upstash Console](https://console.upstash.com/qstash):

```
https://worker-scheduler.<subdomain>.workers.dev/schedule/every-<day>
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
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL (wardrobe panorama cache filter) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
