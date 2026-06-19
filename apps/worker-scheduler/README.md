# worker-scheduler

Cloudflare Worker that acts as the **central scheduler** for SkyDIIV workflows.

It exposes one HTTP endpoint per weekday. Each endpoint is meant to be wired to
an Upstash QStash CRON; when triggered (and after verifying the QStash
signature) it runs whatever **flow** is registered for that day. This makes it
the single entry point for any recurring, day-based job — new schedules are added
by writing a flow and registering it, with no infrastructure changes.

---

## Endpoints

| Endpoint | Day | Flow |
|---|---|---|
| `POST /schedule/every-monday` | Monday | _(none yet)_ |
| `POST /schedule/every-tuesday` | Tuesday | _(none yet)_ |
| `POST /schedule/every-wednesday` | Wednesday | _(none yet)_ |
| `POST /schedule/every-thursday` | Thursday | `generate-wardrobe-panorama` |
| `POST /schedule/every-friday` | Friday | _(none yet)_ |
| `POST /schedule/every-saturday` | Saturday | _(none yet)_ |
| `POST /schedule/every-sunday` | Sunday | `weekly-outfits` |
| `GET /` | — | health check |

A day with no registered flow still verifies the QStash signature and responds
`200 { "day": "...", "flow": null, "message": "No flow configured for ..." }`.
This lets you provision the external schedule ahead of implementing the flow.

---

## Architecture

```
External QStash schedule
  │  POST /schedule/every-<day>  (QStash-signed)
  ▼
worker-scheduler                  (this worker — Cloudflare)
  │  1. Verify QStash signature
  │  2. Resolve the flow registered for <day>
  │  3. Run it (or no-op if none) and return the result
  ▼
<flow-specific downstream>
```

### Weekly outfits flow

```
/schedule/every-<day> → weekly-outfits flow
  │  1. SELECT user_id FROM weekly_outfit_preferences
  │  2. QStash batchJSON → { userId } × N
  ▼
worker-ai-workflows               (Cloudflare — @upstash/workflow)
  POST /generate-weekly-outfits
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (Wrangler 4) |
| Scheduling | Upstash QStash (configured externally) |
| Message queue | Upstash QStash (`@upstash/qstash`) |
| Database | Neon PostgreSQL (pooled, read-only) via `postgres.js` |
| Language | TypeScript 5, strict |
| Testing | Vitest 4 |

---

## Project structure

```
src/
├── index.ts              Worker entry; health check + day-endpoint routing
├── scheduler.ts          Central handler: verify → resolve flow → run
├── flows/
│   ├── types.ts          Weekday, ScheduleFlow, FlowResult abstractions
│   ├── registry.ts       Maps each weekday → its flow
│   └── weekly-outfits.flow.ts  Query users + QStash dispatch
└── lib/
    ├── logger.ts         Structured JSON logger
    ├── qstash.ts         QStash client + receiver singletons
    └── db/
        ├── client.ts     postgres.js singleton
        └── users.repository.ts  Query users with outfit preferences
tests/
└── unit/
    ├── index.test.ts
    ├── scheduler.test.ts
    ├── registry.test.ts
    ├── weekly-outfits-flow.test.ts
    ├── dispatch.test.ts
    └── users-repository.test.ts
```

---

## Adding a new scheduled job

1. Create a flow that implements `ScheduleFlow` (see `src/flows/types.ts`):

```ts
import type { FlowResult, ScheduleFlow } from "./types"

export const myFlow: ScheduleFlow = {
  name: "my-flow",
  async run(): Promise<FlowResult> {
    // ... do the work ...
    return { flow: "my-flow", processed: 0 }
  },
}
```

2. Register it for a day in `src/flows/registry.ts`:

```ts
export const flowRegistry: Partial<Record<Weekday, ScheduleFlow[]>> = {
  sunday: [weeklyOutfitsFlow],
  monday: [myFlow],
}
```

3. Point a QStash schedule at `https://worker-scheduler.<subdomain>.workers.dev/schedule/every-monday`.

No changes to routing (`index.ts`) are required.

---

## Environment variables / secrets

Copy `.env.example` to `.dev.vars` for local development.

| Variable | Required | Used by | Description |
|---|---|---|---|
| `QSTASH_CURRENT_SIGNING_KEY` | ✅ | all endpoints | QStash signing key for verifying incoming schedule requests |
| `QSTASH_NEXT_SIGNING_KEY` | ✅ | all endpoints | QStash next signing key (key rotation) |
| `QSTASH_TOKEN` | ✅ | flows that publish | Upstash QStash API token (for publishing messages) |
| `DATABASE_URL` | ✅ | weekly-outfits flow | Neon PostgreSQL pooled connection string |
| `WEEKLY_OUTFITS_WORKER_URL` | ✅ | weekly-outfits flow | Full endpoint URL of the `worker-ai-workflows` `generate-weekly-outfits` workflow (path included) |
| `WARDROBE_PANORAMA_WORKER_URL` | ✅ | generate-wardrobe-panorama flow | Full endpoint URL of the `worker-ai-workflows` `generate-wardrobe-panorama` workflow (path included) |

### Setting secrets in Cloudflare

```bash
wrangler secret put DATABASE_URL
wrangler secret put QSTASH_TOKEN
wrangler secret put QSTASH_CURRENT_SIGNING_KEY
wrangler secret put QSTASH_NEXT_SIGNING_KEY
wrangler secret put WEEKLY_OUTFITS_WORKER_URL
```

---

## Local development

**Prerequisites:** Node.js 22+, a Cloudflare account, and a working `.dev.vars`.

```bash
# Install dependencies
npm install

# Start the local dev server
npm run dev
```

The worker will be available at `http://localhost:8787`.

- `GET /` — health check
- `POST /schedule/every-<day>` — schedule endpoints (require a QStash signature; use `wrangler dev` + a local tunnel for end-to-end testing)

---

## Setting up external triggers

After deploying the worker, configure one QStash schedule per weekday endpoint
you want active in the [Upstash Console](https://console.upstash.com/qstash).
Point each schedule at the matching destination URL:

`https://worker-scheduler.<subdomain>.workers.dev/schedule/every-<day>`

When and how often each endpoint is invoked (CRON expression, timezone, etc.)
is configured entirely in Upstash — this worker only verifies the QStash
signature and runs whatever flow is registered for that weekday.

To activate a day, register a flow for it (see *Adding a new scheduled job*)
and create a QStash schedule for the matching `/schedule/every-<day>` endpoint.

QStash signs each request with its signing keys, which the worker verifies before proceeding.

---

## Deployment

### Manual

```bash
# Production
npm run deploy

# Staging
npm run deploy -- --env staging
```

### CI/CD (GitHub Actions)

Defined in `.github/workflows/deploy-worker-scheduler.yml`.

- Push to `staging` → deploy to `worker-scheduler-staging`
- Push to `main`    → deploy to `worker-scheduler`

Required GitHub secrets (same account-level secrets as the workflow worker):

| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token with Worker deploy permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `DATABASE_URL` | Neon pooled connection string |
| `QSTASH_TOKEN` | Upstash QStash API token |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash current signing key |
| `QSTASH_NEXT_SIGNING_KEY` | QStash next signing key |
| `WEEKLY_OUTFITS_WORKER_URL` | worker-ai-workflows `/generate-weekly-outfits` endpoint URL |

---

## Testing

```bash
# Run all unit tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

---

## Linting

```bash
npm run lint
npm run lint:fix
```

---

## Security

- All incoming schedule requests **must be signed by QStash** (`upstash-signature` header). Requests without a valid signature are rejected with `401 Unauthorized`.
- The worker has no user-facing authentication — it is an internal automation endpoint.
- `DATABASE_URL`, `QSTASH_TOKEN`, and signing keys are stored as encrypted Cloudflare Worker secrets, never in `wrangler.toml` or source code.
