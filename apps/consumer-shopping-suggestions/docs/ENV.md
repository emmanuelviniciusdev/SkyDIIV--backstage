# Environment files

All **local** secrets live in this project directory. Nothing under `~/.skydiiv/`.

| File | Where | Used by |
|---|---|---|
| **`.env`** | Project root (`apps/consumer-shopping-suggestions/.env`) | Local dev **and** local OCI deploy |
| **`.env.example`** | Committed template | `cp .env.example .env` |
| **`/etc/skydiiv/consumer-shopping-suggestions.env`** | OCI VM only | systemd after deploy |
| GitHub secret `CONSUMER_SHOPPING_SUGGESTIONS_ENV` | Actions | CI deploy → VM env file |

```
Local (this repo)                    OCI VM
─────────────────                    ──────
.env  ──► npm run dev
      ──► docker compose
      ──► ./scripts/publish-event.sh
      ──► deploy/deploy-from-local.sh (default)
                                       /etc/skydiiv/consumer-shopping-suggestions.env
                                       ◄── GitHub Actions / deploy script
```

## Setup

```bash
cd apps/consumer-shopping-suggestions
cp .env.example .env
# Required: CF_ACCOUNT_ID, CF_QUEUE_ID, CF_QUEUES_API_TOKEN, DATABASE_URL
# Optional: WEB_APP_REDIS_REST_*
```

Broker is always **Cloudflare Queues** (local and production).

## Local OCI deploy

`deploy-from-local.sh` reads **`.env`** by default (override with `--env-file` if needed):

```bash
./deploy/deploy-from-local.sh --test \
  --ssh-key ~/.ssh/skydiiv-oci-css
```

Same keys as day-to-day dev. Leave **`PROXY_URLS`** empty — infra sets it on the VM.

## CI / GitHub Actions → VM

### GitHub secret: `CONSUMER_SHOPPING_SUGGESTIONS_ENV`

| Question | Answer |
|---|---|
| **Variable** or **Secret**? | **Secret** (sensitive data — tokens, DB URLs) |
| Format | **Plain `.env` text** (`KEY=value`, one variable per line). |
| Where to set it | **Environment secret** on `staging` and/or `production` |
| Size | Typically ~15–25 lines (~1–2 KB). GitHub limit: 64 KB per secret |
| What the workflow does | Writes the content to `/etc/skydiiv/consumer-shopping-suggestions.env` on the VM |

Use the **same keys** as `.env.example` / local `.env`, with staging or production values.
**Do not include `PROXY_URLS`** — infra sets that on the VM.

#### Example content (paste as plain text)

```env
CF_ACCOUNT_ID=...
CF_QUEUE_ID=...
CF_QUEUES_API_TOKEN=...
CF_QUEUES_BATCH_SIZE=10
CF_QUEUES_POLL_INTERVAL_MS=600000
CF_QUEUES_VISIBILITY_TIMEOUT_MS=7200000
WEB_APP_REDIS_REST_URL=...
WEB_APP_REDIS_REST_TOKEN=...
DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://user:pass@host:5432/dbname?sslmode=require
CONSUMER_CONCURRENCY=10
LOG_LEVEL=INFO
CAMOUFOX_HEADLESS=true
```

#### GitHub CLI (from local `.env`)

```bash
cd apps/consumer-shopping-suggestions

# Set production values in .env before uploading
gh secret set CONSUMER_SHOPPING_SUGGESTIONS_ENV --env production < .env

# Staging (if you use the staging branch)
gh secret set CONSUMER_SHOPPING_SUGGESTIONS_ENV --env staging < .env
```

#### Do **not**

- Do not use **Environment variables** for this — variables are not for app secrets
- Do not convert to JSON — the workflow expects dotenv format
- Do not commit `.env` to the repository (it is gitignored)
