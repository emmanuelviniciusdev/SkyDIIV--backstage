# Environment files

| Source | Where | Used by |
|---|---|---|
| **`.env`** | `apps/robot-shopping-suggestions/.env` (git-ignored) | `npm run dev`, `docker compose`, `./scripts/publish-event.sh`, local `terraform apply` |
| **`.env.example`** | Committed template | `cp .env.example .env` |
| GitHub secret **`ROBOT_SHOPPING_SUGGESTIONS_ENV`** | `production` environment | Weekly create → `TF_VAR_robot_env` → container env |

```
.env ──► npm run dev / docker compose / publish-event.sh
     └─► deploy/build-robot-env.py ──► TF_VAR_robot_env ──┐
                                                          ├─► Container Instance env
GitHub secret ROBOT_SHOPPING_SUGGESTIONS_ENV ─────────────┘
```

## Setup

```bash
cd apps/robot-shopping-suggestions
cp .env.example .env
# Required: CF_ACCOUNT_ID, CF_SCRAPE_SHOPP_SUGG_QUEUE_ID, CF_QUEUES_API_TOKEN, DATABASE_URL
```

## Variables

Validated by `src/infrastructure/config/env.ts` (Zod) — an invalid value fails at
boot, not mid-drain.

| Variable | Default | Purpose |
|---|---|---|
| `CF_ACCOUNT_ID` | _(required)_ | Cloudflare account |
| `CF_SCRAPE_SHOPP_SUGG_QUEUE_ID` | _(required)_ | Queue id (pull + publish) |
| `CF_QUEUES_API_TOKEN` | _(required)_ | Needs **Queues Edit** |
| `CF_QUEUES_BATCH_SIZE` | `2` | Messages per pull |
| `CF_QUEUES_VISIBILITY_TIMEOUT_MS` | `7200000` (2 h) | Lease while a batch is processed |
| `ROBOT_CONCURRENCY` | `2` | In-flight messages inside a batch |
| `DATABASE_URL` | _(required)_ | Postgres (pooled, reads) |
| `DATABASE_URL_UNPOOLED` | `DATABASE_URL` | Direct connection for writes |
| `WEB_APP_REDIS_REST_URL` / `_TOKEN` | _(optional)_ | Web-app Redis over REST (Upstash) |
| `WEB_APP_REDIS_URL` | _(optional)_ | Redis URL fallback when REST vars are absent |
| `SCRAPE_DELAY_MIN_MS` / `_MAX_MS` | `800` / `2500` | Random delay between navigations |
| `CAMOUFOX_HEADLESS` | `true` | `false`/`0` opens a window |
| `CAMOUFOX_INSTALL_DIR` | _(image default)_ | Camoufox location inside the image |
| `PROXY_URLS` | _(empty)_ | Comma-separated outbound proxies |
| `LOG_LEVEL` | `INFO` | `DEBUG` \| `INFO` \| `WARN` \| `ERROR` |

Without web-app Redis the robot still scrapes and persists; only cache
invalidation and the notification flag are skipped (logged as a warning).

## CI / GitHub Actions

### `ROBOT_SHOPPING_SUGGESTIONS_ENV`

An **environment secret** on `production`, in plain `.env` format:

```env
CF_ACCOUNT_ID=...
CF_SCRAPE_SHOPP_SUGG_QUEUE_ID=...
CF_QUEUES_API_TOKEN=...
CF_QUEUES_VISIBILITY_TIMEOUT_MS=7200000
WEB_APP_REDIS_REST_URL=...
WEB_APP_REDIS_REST_TOKEN=...
DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://user:pass@host:5432/dbname?sslmode=require
LOG_LEVEL=INFO
```

```bash
gh secret set ROBOT_SHOPPING_SUGGESTIONS_ENV --env production < .env
```

Terraform merges its own values **over** this secret, so these keys are set by
the infrastructure and do not need to be in it: `COMPUTE_PROVIDER`,
`ROBOT_DISPLAY_NAME`, `OCI_COMPARTMENT_OCID`, `OCI_REGION`, `OCI_TENANCY_OCID`,
`OCI_USER_OCID`, `OCI_FINGERPRINT`, `CF_QUEUES_BATCH_SIZE`, `ROBOT_CONCURRENCY`,
`CAMOUFOX_HEADLESS`. `OCI_API_PRIVATE_KEY` is injected by the workflow from the
`OCI_API_PRIVATE_KEY` secret.

Registry secrets (`OCIR_NAMESPACE`, `OCIR_USERNAME`, `OCIR_AUTH_TOKEN`) and the
OCI identity secrets are listed in [deploy/README.md](../deploy/README.md#secrets--variables).

## Self-delete

Self-delete is how the robot turns itself off (see
[README — Lifecycle](../README.md#lifecycle--how-the-robot-is-turned-on-and-off)).
It goes through a provider chosen by `COMPUTE_PROVIDER`:

| Value | Behavior |
|---|---|
| _(empty)_ | Auto-detect: `oci` when credentials **and** a target are present, else `noop` |
| `noop` | No cloud call — local runs and tests |
| `oci` | Signed `DELETE` on the Container Instance after the drain |

The `oci` provider needs `OCI_REGION`, `OCI_TENANCY_OCID`, `OCI_USER_OCID`,
`OCI_FINGERPRINT`, `OCI_API_PRIVATE_KEY` (PEM contents or path), plus either
`OCI_CONTAINER_INSTANCE_OCID` or `OCI_COMPARTMENT_OCID` + `ROBOT_DISPLAY_NAME`.
With `COMPUTE_PROVIDER=oci` but incomplete credentials it falls back to `noop`
and logs a warning.

### Waiting for ACTIVE

A Container Instance can only be deleted from `ACTIVE`, and a drain over an
empty queue finishes in about a second — before OCI promotes the instance out of
`CREATING`. `terraform apply` waits for that same transition, so the robot
deliberately outlives it.

| Variable | Default | Purpose |
|---|---|---|
| `SELF_DELETE_WAIT_ACTIVE_MS` | `240000` | Give up if `ACTIVE` never arrives |
| `SELF_DELETE_POLL_INTERVAL_MS` | `5000` | Poll interval while waiting |
| `SELF_DELETE_ACTIVE_GRACE_MS` | `120000` | Extra delay so `apply` observes `ACTIVE` first |

Set `SELF_DELETE_ACTIVE_GRACE_MS=0` when nothing is waiting on the apply.

To add another cloud, implement `SelfDeletePort` under
`src/infrastructure/compute/providers/` and register it in
`self-delete.provider.factory.ts`.
