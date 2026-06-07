# upstash-schedule-weekly-outfits

Cloudflare Worker that acts as the **weekly outfit generation scheduler** for Skydiiv.

Triggered every **Sunday at 18:00 BRT (21:00 UTC)** by an Upstash QStash CRON, it queries the database for all users who have outfit preferences configured and dispatches one QStash message per user to the [weekly-outfits workflow worker](../upstash-workflow-generate-weekly-outfits/).

---

## Architecture

```
Upstash Scheduler (QStash CRON)
  │  every Sunday 21:00 UTC (18:00 BRT)
  │  POST /schedule  (QStash-signed)
  ▼
weekly-outfits-scheduler          (this worker — Cloudflare)
  │  1. Verify QStash signature
  │  2. SELECT user_id FROM weekly_outfit_preferences
  │  3. QStash batchJSON → { userId } × N
  ▼
weekly-outfits-worker             (Cloudflare — @upstash/workflow)
  │  for each userId:
  │    Step 1: build-prompt  (preferences + wardrobe + weather)
  │    Step 2: execute-prompt (Gemini LLM)
  │    Step 3: save-outfits   (Neon PostgreSQL)
  │    Step 4: generate-images (R2)
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (Wrangler 4) |
| Scheduling | Upstash QStash CRON |
| Message queue | Upstash QStash (`@upstash/qstash`) |
| Database | Neon PostgreSQL (pooled, read-only) via `postgres.js` |
| Language | TypeScript 5, strict |
| Testing | Vitest 4 |

---

## Project structure

```
src/
├── index.ts              Worker entry; health check + route dispatch
├── scheduler.ts          Main handler: verify → query → QStash dispatch
└── lib/
    ├── logger.ts         Structured JSON logger
    ├── db/
    │   ├── client.ts     postgres.js singleton
    │   └── users.repository.ts  Query users with outfit preferences
    └── qstash.ts         QStash client, receiver, and batch dispatcher
tests/
├── unit/
│   ├── users-repository.test.ts
│   ├── scheduler.test.ts
│   └── dispatch.test.ts
```

---

## Environment variables / secrets

Copy `.env.example` to `.dev.vars` for local development.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon PostgreSQL pooled connection string |
| `QSTASH_TOKEN` | ✅ | Upstash QStash API token (for publishing messages) |
| `QSTASH_CURRENT_SIGNING_KEY` | ✅ | QStash signing key for verifying incoming CRON requests |
| `QSTASH_NEXT_SIGNING_KEY` | ✅ | QStash next signing key (key rotation) |
| `WEEKLY_OUTFITS_WORKER_URL` | ✅ | Public URL of the `weekly-outfits-worker` Cloudflare Worker |

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
- `POST /schedule` — schedule endpoint (requires QStash signature; use `wrangler dev` + a local tunnel for end-to-end testing)

---

## Setting up the Upstash QStash CRON

After deploying the worker, configure the CRON in the [Upstash Console](https://console.upstash.com/qstash):

| Field | Value |
|---|---|
| **Destination URL** | `https://weekly-outfits-scheduler.<subdomain>.workers.dev/schedule` |
| **CRON expression** | `0 21 * * 0` |
| **Schedule** | Every Sunday at 21:00 UTC (= 18:00 BRT / Brasília) |

> **Why 21:00 UTC?**
> Brasília follows BRT (UTC-3) for most of the year. 18:00 BRT = 21:00 UTC.
> During Brazilian summer time (BRST, UTC-2, ~Nov–Feb), the job fires at 19:00 local time.
> Adjust to `0 20 * * 0` during those months if strict 18:00 local time is required.

QStash will sign each request with its signing keys, which the worker verifies before proceeding.

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

Defined in `.github/workflows/deploy-weekly-outfits-scheduler.yml`.

- Push to `staging` → deploy to `weekly-outfits-scheduler-staging`
- Push to `main`    → deploy to `weekly-outfits-scheduler`

Required GitHub secrets (same account-level secrets as the workflow worker):

| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token with Worker deploy permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `DATABASE_URL` | Neon pooled connection string |
| `QSTASH_TOKEN` | Upstash QStash API token |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash current signing key |
| `QSTASH_NEXT_SIGNING_KEY` | QStash next signing key |
| `WEEKLY_OUTFITS_WORKER_URL` | Weekly outfits workflow worker URL |

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

## How "eligible users" are determined

A user is eligible for weekly outfit generation if they have a row in the `weekly_outfit_preferences` table with both `location` and `routine_description` set (non-null, non-empty). This is the opt-in signal per the Skydiiv web app's Prisma schema.

```sql
SELECT user_id
FROM weekly_outfit_preferences
WHERE location IS NOT NULL
  AND location <> ''
  AND routine_description IS NOT NULL
  AND routine_description <> ''
```

---

## Security

- All incoming requests **must be signed by QStash** (`upstash-signature` header). Requests without a valid signature are rejected with `401 Unauthorized`.
- The worker has no user-facing authentication — it is an internal automation endpoint.
- `DATABASE_URL`, `QSTASH_TOKEN`, and signing keys are stored as encrypted Cloudflare Worker secrets, never in `wrangler.toml` or source code.
