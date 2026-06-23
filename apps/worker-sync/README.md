# worker-sync

Cloudflare Worker that hosts SkyDIIV's data-synchronization workflows. Each workflow is a durable, multi-step job exposed at its own HTTP endpoint and orchestrated via Upstash Workflow + QStash.

Workflows are registered with `serveMany`, which routes requests by the **last path segment** of the URL.

| Endpoint | Workflow | Documentation |
|---|---|---|
| `POST /sync/language` | `sync-language` | [docs/SYNC_LANGUAGE_WORKFLOW.md](./docs/SYNC_LANGUAGE_WORKFLOW.md) |
| `GET /` | — | Health check → `{ status: "ok", timestamp }` |

```mermaid
flowchart LR
    APP["SkyDIIV app / services"] -->|POST signed payload| SL["POST /sync/language"]
    SL --> SFW["sync-language workflow"]
    SFW --> DB[("Neon PostgreSQL")]
    SFW --> LLM["Gemini"]
```

---

## Services & Technologies

| Layer | Technology | Role |
|---|---|---|
| Runtime | [Cloudflare Workers](https://developers.cloudflare.com/workers/) (`nodejs_compat`) | Hosts this worker |
| Language | TypeScript 5 (strict) | Implementation |
| Workflow orchestration | [Upstash Workflow](https://upstash.com/docs/workflow) + [QStash](https://upstash.com/docs/qstash) | Durable steps, retries, signed delivery |
| Database | [Neon](https://neon.tech) PostgreSQL via [postgres.js](https://github.com/porsager/postgres) | Shared schema with the SkyDIIV web app |
| Language model | [Google Gemini](https://ai.google.dev/) (`gemini-2.5-flash` default) | Translates AI-generated content on language change |
| Validation | [Zod](https://zod.dev/) | Payload and LLM response validation |
| Dev / deploy | Wrangler 4 | Local dev and Cloudflare deployment |
| Testing | Vitest 4 | Unit + integration tests |
| Linting | ESLint 10 + typescript-eslint | Code quality |
| CI/CD | GitHub Actions | Lint, test, deploy on push to `main` / `staging` |

---

## Project Structure

```
├── docs/
│   └── SYNC_LANGUAGE_WORKFLOW.md           # sync-language — workflow reference
├── src/
│   ├── index.ts                            # Worker entry (health check + serveMany dispatch)
│   ├── workflows/
│   │   ├── index.ts                        # Endpoint registry
│   │   └── sync-language/
│   └── lib/                                # Shared DB, LLM, prompts, logging
├── tests/
│   ├── unit/
│   └── integration/
├── wrangler.toml
├── .env.example                            # Copy to .dev.vars for local dev
└── package.json
```

---

## Adding a New Sync Workflow

1. Create `src/workflows/<name>/workflow.ts` with `createWorkflow(...)`:

```ts
import { createWorkflow } from "@upstash/workflow/cloudflare"

export interface MySyncPayload {
  userid: string
}

export const mySyncWorkflow = createWorkflow<MySyncPayload, void>(async (context) => {
  // context.run("step-name", async () => { ... })
})
```

2. Register it in `src/workflows/index.ts` under the **last path segment** of the public URL:

```ts
const { fetch: serveManyFetch } = serveMany({
  language: syncLanguageWorkflow,
  "my-endpoint": mySyncWorkflow, // POST /sync/my-endpoint
})
```

3. Add a doc under `docs/` and link it from this README. No changes to `src/index.ts` are needed.

> Workflow keys cannot contain `/`. `serveMany` matches on the last URL path segment; QStash step callbacks preserve that path automatically.

---

## Security

- No end-user authentication — internal automation only
- All workflow requests are signed by QStash and verified before any step runs
- `GET /` is the only unsigned endpoint (health check)
- `userid` comes from the verified workflow payload
- Secrets (database, cache) are Cloudflare Worker secrets — never in source control

---

## Getting Started

### Prerequisites

- Node.js 22+
- Wrangler 4
- Accounts / credentials for Cloudflare Workers, Upstash (QStash), and Neon PostgreSQL
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/) for local workflow callback testing

### Local Development

```bash
npm install
cp .env.example .dev.vars   # fill in secrets
npm run dev                 # http://localhost:8787
```

Expose the local worker for Upstash callbacks:

```bash
cloudflared tunnel --url http://localhost:8787
```

Set the tunnel origin (no path) as `WORKER_SYNC_URL` in `.dev.vars` and restart `npm run dev`.

Trigger the sync-language workflow:

```bash
curl -X POST https://<tunnel-origin>/sync/language \
  -H "Content-Type: application/json" \
  -d '{"userid":"<USER_ID>","old_language":"en-US","new_language":"pt-BR"}'
```

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
| Worker name (production) | `worker-sync` |
| Worker name (staging) | `worker-sync-staging` |
| Entry point | `src/index.ts` |
| Compatibility date | `2025-01-01` |
| Compatibility flags | `nodejs_compat` |

### Secrets

Set via `wrangler secret put <KEY>` in production, or `.dev.vars` locally. See `.env.example` for the full list.

| Secret | Used by |
|---|---|
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | All workflows |
| `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_*_SIGNING_KEY` | All workflows |
| `WORKER_SYNC_URL` | All workflows + web app — worker origin (no path); web app appends `/sync/language` for QStash delivery |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | `sync-language` (LLM translation) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | `sync-language` (cache invalidation) |

`WORKER_SYNC_URL` is shared between the web app (initial QStash delivery) and this worker (Upstash Workflow step callbacks via `serveMany` `baseUrl`).

---

## Deployment

CI runs lint + test on PRs; deploys on push to `staging` or `main` when files under `apps/worker-sync/` change (`.github/workflows/deploy-worker-sync.yml`).

```bash
npm run deploy                  # production
npm run deploy -- --env staging # staging
```

After the first deploy, set `WORKER_SYNC_URL` to the deployed worker origin:

```bash
wrangler deployments list
wrangler secret put WORKER_SYNC_URL
# e.g. https://worker-sync.<subdomain>.workers.dev
```

The web app uses the same `WORKER_SYNC_URL` origin and targets `{WORKER_SYNC_URL}/sync/language` for the initial QStash message.

### GitHub Secrets (deploy)

| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers deploy permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_SUBDOMAIN` | `*.workers.dev` subdomain |
