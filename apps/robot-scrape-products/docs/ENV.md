# Environment files

| Source | Where | Used by |
|---|---|---|
| **`.env`** | `apps/robot-scrape-products/.env` (git-ignored) | `npm run dev`, `docker compose`, `./scripts/publish-event.sh`, local `terraform apply` |
| **`.env.example`** | Committed template | `cp .env.example .env` |
| GitHub secret **`ROBOT_SCRAPE_PRODUCTS_ENV`** | `production` environment | Weekly create → `TF_VAR_robot_env` → container env |

```
.env ──► npm run dev / docker compose / publish-event.sh
     └─► deploy/build-robot-env.py ──► TF_VAR_robot_env ──┐
                                                          ├─► Container Instance env
GitHub secret ROBOT_SCRAPE_PRODUCTS_ENV ─────────────┘
```

## Setup

```bash
cd apps/robot-scrape-products
cp .env.example .env
# Required: QSTASH_TOKEN, WORKER_OUTBOX_EVENTS_URL (origin only), DATABASE_URL
```

## Variables

Validated by `src/infrastructure/config/env.ts` (Zod) — an invalid value fails at
boot, not mid-drain.

| Variable | Default | Purpose |
|---|---|---|
| `QSTASH_TOKEN` | _(required)_ | Publish `{ outboxEventId }` to worker-outbox-events |
| `QSTASH_URL` | `https://qstash.upstash.io` | Optional QStash API origin |
| `WORKER_OUTBOX_EVENTS_URL` | _(required)_ | worker-outbox-events **origin only** (no path) |
| `ROBOT_CONCURRENCY` | `2` | In-flight search terms inside a panorama |
| `DATABASE_URL` | _(required)_ | Postgres (pooled, reads) |
| `DATABASE_URL_UNPOOLED` | `DATABASE_URL` | Direct connection for writes |
| `WEB_APP_REDIS_REST_URL` / `_TOKEN` | _(optional, unused)_ | Web-app Redis (automatic thrifting does not write Redis) |
| `WEB_APP_REDIS_URL` | _(optional, unused)_ | Redis URL fallback |
| `SCRAPE_DELAY_MIN_MS` / `_MAX_MS` | `800` / `2500` | Random delay between navigations |
| `CAMOUFOX_HEADLESS` | `true` | `false`/`0` opens a window |
| `CAMOUFOX_INSTALL_DIR` | _(image default)_ | Camoufox location inside the image |
| `PROXY_URLS` | _(empty)_ | Comma-separated outbound proxies |
| `LOG_LEVEL` | `INFO` | `DEBUG` \| `INFO` \| `WARN` \| `ERROR` |

Validated by `src/infrastructure/config/env.ts` (Zod) — an invalid value fails at
boot, not mid-scrape.

## CI / GitHub Actions

### `ROBOT_SCRAPE_PRODUCTS_ENV`

An **environment secret** on `production`, in plain `.env` format:

```env
QSTASH_TOKEN=...
WORKER_OUTBOX_EVENTS_URL=https://worker-outbox-events.<subdomain>.workers.dev
DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://user:pass@host:5432/dbname?sslmode=require
LOG_LEVEL=INFO
```

```bash
gh secret set ROBOT_SCRAPE_PRODUCTS_ENV --env production < .env
```

Terraform merges its own values **over** this secret, so these keys are set by
the infrastructure and do not need to be in it: `COMPUTE_PROVIDER`,
`ROBOT_DISPLAY_NAME`, `OCI_COMPARTMENT_OCID`, `OCI_REGION`, `OCI_TENANCY_OCID`,
`OCI_USER_OCID`, `OCI_FINGERPRINT`, `ROBOT_CONCURRENCY`,
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
