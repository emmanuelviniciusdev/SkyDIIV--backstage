# Deploy — Consumer Shopping Suggestions

Provisioning + deploy on **Oracle Cloud pay-as-you-go** compute (Ampere A1 Flex),
with a **weekly start/stop window** to keep costs low.

## Cost model

| Mode | Compute billing |
|---|---|
| **Production schedule** | VM **RUNNING** only **Thursday 11:00–12:00** (`America/Sao_Paulo`) — 1h/week |
| **Test / localhost** | Schedule **disabled**; you start the VM on demand and leave it running |
| **Monthly ceiling** | Default **`$5.00` USD** — cost guard runs **`terraform destroy`** on the consumer stack when Usage API MTD cost ≥ limit |

Default shape: `VM.Standard.A1.Flex` — **2 OCPU / 4 GB** (paid). Stopped VMs do not bill OCPU/RAM (boot volume still may).

Schedule CRON (UTC), matching [schedule-defaults.json](./schedule-defaults.json):

| Action | Local (BRT) | UTC CRON |
|---|---|---|
| START | Thursday 11:00 | `0 14 * * 4` |
| STOP | Thursday 12:00 | `0 15 * * 4` |

```
GitHub Actions / localhost
  ├─ CI (lint / test / build)          [CI only]
  ├─ Terraform
  │    ├─ VCN + subnet (IPv4 + IPv6)
  │    ├─ Internet Gateway + routes + security list
  │    ├─ Paid VM (Ampere A1 Flex)
  │    ├─ Extra IPv6 addresses for egress rotation
  │    ├─ Resource Scheduler start/stop (production only)
  │    └─ Monthly Budget + email alerts (cost ceiling)
  ├─ Ensure VM is RUNNING (instance action START)
  ├─ SCP release + ipv6-addresses.txt
  └─ SSH remote-deploy.sh
        ├─ setup-proxy-pool.sh
        ├─ merge-env.sh
        ├─ npm ci + camoufox fetch
        └─ systemctl restart consumer

GitHub Actions cron (daily 12:00 UTC) + manual workflow_dispatch
  └─ oci_cost_guard.py → terraform destroy consumer stack if MTD cost ≥ cost_limit_usd
```

## Weekly schedule vs test mode

| | Production | Test (`--test` / staging) |
|---|---|---|
| `enable_weekly_schedule` | `true` | `false` |
| Resource Scheduler | Creates START + STOP | **Not created** (or destroyed) |
| When can the VM run? | Only Thu 11:00–12:00 BRT (unless you start manually mid-window) | Anytime you start it |
| After localhost deploy | Script **STOP**s the VM again | VM left **RUNNING** |

**Identity policy:** Terraform can create a Resource Scheduler policy (OCI name
`${name_prefix}-resource-scheduler`, e.g. `css-production-resource-scheduler`) so the
Resource Scheduler service principal may manage consumer instances in the compartment.
Set `create_resource_scheduler_policy = false` if you already have an equivalent
tenancy policy.

---

## Monthly cost limit (`$5` default)

Two layers (defaults in [cost-limit-defaults.json](./cost-limit-defaults.json)):

| Layer | What it does |
|---|---|
| **OCI Budget** (`budget.tf`) | Monthly ABSOLUTE amount = `cost_limit_usd`; emails at **80%** and **100%** |
| **Cost guard** (`oci_cost_guard.py`) | Queries Usage API MTD cost; if ≥ limit → **`terraform destroy`** on the consumer stack (VM, VCN, IPv6, schedules, budget, scheduler policy). Fallback: TERMINATE instance if state is missing. |

Budgets alone **never** delete resources — the GitHub Actions workflow
`.github/workflows/cost-guard-consumer-shopping-suggestions.yml` runs **once per day**
(`0 12 * * *` UTC ≈ 09:00 BRT) and can also be started **manually** via
**Actions → Cost guard — Consumer Shopping Suggestions → Run workflow**
(`workflow_dispatch`, optional `dry_run`).

Terraform vars:

```hcl
enable_cost_limit = true
cost_limit_usd    = 5
cost_alert_email  = "emmanuel.bergmann@icloud.com"
```

GitHub (production environment):

| Name | Type | Purpose |
|---|---|---|
| `COST_ALERT_EMAIL` | secret | Optional override; default `emmanuel.bergmann@icloud.com` |
| `COST_LIMIT_USD` | variable | Optional override (default `5`) |
| `ENABLE_COST_LIMIT` | variable | Optional; defaults to `true` (default alert email is always set) |
| `OCI_INSTANCE_OCID` | secret | Fallback TERMINATE if Terraform state is missing in the cost-guard job |

**Caveats**

1. The budget **targets `compartment_ocid`**. If that is the tenancy root, the **`$5`**
   ceiling applies to **all spend in that compartment** (often the whole tenancy).
   Prefer a dedicated compartment for the consumer so the **`$5`** cap is not tenancy-wide.
2. Usage API cost data can lag **up to ~24h** — treat the kill as eventual, not
   instantaneous.
3. After destroy, recreate with `cd deploy/terraform && terraform apply`.
   Until the calendar month resets (or the limit is raised), a new apply may be
   destroyed again on the next cost-guard run if MTD spend is still ≥ limit.

Manual dry-run:

```bash
cd apps/consumer-shopping-suggestions
export OCI_TENANCY_OCID=... OCI_USER_OCID=... OCI_FINGERPRINT=...
export OCI_API_PRIVATE_KEY_PATH=/path/to/oci_api_key.pem
export OCI_REGION=us-ashburn-1
export OCI_COMPARTMENT_OCID=...
# Optional fallback if terraform state is empty:
# export OCI_INSTANCE_OCID="$(cd deploy/terraform && terraform output -raw instance_ocid)"

# TF_VAR_* must match a normal terraform apply (or use terraform.tfvars locally)
python3 deploy/oci_cost_guard.py --limit 5 --terraform-dir deploy/terraform --dry-run
```

---

## Localhost deploy for tests (schedule does not apply)

Use this when you need to exercise the consumer **outside** Thursday 11:00–12:00,
or keep the VM up while debugging.

### Prerequisites

1. `deploy/terraform/terraform.tfvars` filled (see `terraform.tfvars.example`)
2. SSH key pair matching `ssh_public_key`
3. **`.env`** filled from `.env.example` (app secrets for dev and local deploy — see [docs/ENV.md](../docs/ENV.md))
4. Tools: `terraform`, `npm`, `ssh`/`scp`, `python3`, and `pip install oci`

### Run test deploy

```bash
cd apps/consumer-shopping-suggestions
chmod +x deploy/*.sh

./deploy/deploy-from-local.sh --test \
  --ssh-key ~/.ssh/skydiiv-oci-css \
  --yes
```

What `--test` does:

1. `terraform apply -var='enable_weekly_schedule=false'` → **removes / skips** the Thursday schedules
2. **START**s the VM immediately (does not wait for Thursday)
3. Builds, uploads, and runs `remote-deploy.sh`
4. Leaves the VM **RUNNING**

Re-enable production schedule when finished:

```bash
cd deploy/terraform
terraform apply -var='enable_weekly_schedule=true' -auto-approve
# optional: stop the VM until next Thursday
python3 ../oci_instance_action.py STOP --wait
```

### Production-like localhost deploy

```bash
./deploy/deploy-from-local.sh --production \
  --ssh-key ~/.ssh/skydiiv-oci-css \
  --yes
```

Keeps schedules enabled, starts the VM for the deploy, then **STOP**s it so compute
returns to the weekly window.

### Manual start / stop

```bash
cd deploy/terraform
export OCI_INSTANCE_OCID="$(terraform output -raw instance_ocid)"
export OCI_REGION=us-ashburn-1
export OCI_API_PRIVATE_KEY_PATH=/Users/you/.oci/oci_api_key.pem
export OCI_TENANCY_OCID=...
export OCI_USER_OCID=...
export OCI_FINGERPRINT=...

python3 ../oci_instance_action.py START --wait
python3 ../oci_instance_action.py STOP --wait
python3 ../oci_instance_action.py GET
```

---

## GitHub Environment configuration

Configure secrets in **GitHub → Settings → Environments → `staging` / `production`**.

### Where to get each secret

| Secret | Source | How to obtain |
|---|---|---|
| `OCI_TENANCY_OCID` | Oracle Cloud | Profile → **Tenancy** → OCID |
| `OCI_USER_OCID` | Oracle Cloud | Profile → **User settings** → OCID |
| `OCI_FINGERPRINT` | Oracle Cloud | User settings → **API keys** → fingerprint |
| `OCI_API_PRIVATE_KEY` | Oracle Cloud | Add API key → paste full PEM into the secret |
| `OCI_REGION` | Oracle Cloud | Home region (e.g. `us-ashburn-1`) |
| `OCI_COMPARTMENT_OCID` | Oracle Cloud | Identity → Compartments → OCID |
| `OCI_SSH_PUBLIC_KEY` | You generate | `ssh-keygen` → `.pub` file (one line) |
| `OCI_SSH_PRIVATE_KEY` | Matching key | Private key file (multiline) for Actions SCP/SSH |
| `CONSUMER_SHOPPING_SUGGESTIONS_ENV` | You compose | **Environment secret** — full `.env` file as plain text (not JSON). See [docs/ENV.md](../docs/ENV.md#github-secret-consumer_shopping_suggestions_env). |
| `TF_BACKEND_HCL` | Optional | Remote Terraform backend snippet |
| `COST_ALERT_EMAIL` | Optional | Override budget alert inbox (default `emmanuel.bergmann@icloud.com`) |
| `OCI_INSTANCE_OCID` | Optional | Fallback for cost-guard workflow if Terraform state is missing |

#### OCI VM SSH key pair

```bash
ssh-keygen -t ed25519 -C "skydiiv-consumer-shopping-suggestions" -f ~/.ssh/skydiiv-oci-css -N ""
cat ~/.ssh/skydiiv-oci-css.pub    # → OCI_SSH_PUBLIC_KEY
cat ~/.ssh/skydiiv-oci-css       # → OCI_SSH_PRIVATE_KEY
```

### Variables

| Variable | Default | Purpose |
|---|---|---|
| `IPV6_COUNT` | `4` | Extra IPv6 addresses for egress rotation |
| `PROXY_BASE_PORT` | `11080` | First local SOCKS port |
| `INSTANCE_SHAPE` | `VM.Standard.A1.Flex` | Paid Ampere shape |
| `INSTANCE_OCPUS` | `2` | OCPUs |
| `INSTANCE_MEMORY_GB` | `4` | RAM (GB) |
| `AVAILABILITY_DOMAIN_INDEX` | `0` | Change on out-of-capacity |
| `ENABLE_WEEKLY_SCHEDULE` | `true` (prod) / `false` (staging) | Thursday start/stop |
| `ENABLE_COST_LIMIT` | `true` by default | OCI Budget + cost guard |
| `COST_LIMIT_USD` | `5` | Monthly spend ceiling (USD) |

### `CONSUMER_SHOPPING_SUGGESTIONS_ENV` (app secrets on the VM)

**Type:** GitHub **Environment secret** (not a Variable).  
**Format:** multiline `.env` text — **not JSON**.

The workflow copies the entire value to `/etc/skydiiv/consumer-shopping-suggestions.env` on the VM.

**How to configure (quick):**

1. GitHub → **Settings** → **Environments** → `production` or `staging`
2. **Add secret** → name `CONSUMER_SHOPPING_SUGGESTIONS_ENV`
3. Paste your `.env` contents (production/staging values)

Or via CLI:

```bash
cd apps/consumer-shopping-suggestions
gh secret set CONSUMER_SHOPPING_SUGGESTIONS_ENV --env production < .env
```

Full guide: [docs/ENV.md](../docs/ENV.md#github-secret-consumer_shopping_suggestions_env).

```env
CF_ACCOUNT_ID=...
CF_QUEUE_ID=...
CF_QUEUES_API_TOKEN=...
CF_QUEUES_BATCH_SIZE=10
CF_QUEUES_POLL_INTERVAL_MS=600000
WEB_APP_REDIS_REST_URL=
WEB_APP_REDIS_REST_TOKEN=
DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://user:pass@host:5432/dbname?sslmode=require
CONSUMER_CONCURRENCY=10
LOG_LEVEL=INFO
CAMOUFOX_HEADLESS=true
```

## What each layer owns

| Concern | Owner |
|---|---|
| VCN / subnet / IGW / security | Terraform |
| Paid VM | Terraform (`oci_core_instance`) |
| Thursday START / STOP | Terraform (`oci_resource_scheduler_schedule`) when enabled |
| Monthly budget + email alerts | Terraform (`oci_budget_budget`) when enabled |
| Hard cost kill (`terraform destroy`) | `oci_cost_guard.py` + GitHub Actions cron |
| Public IPv6 pool | Terraform (`oci_core_ipv6`) |
| Bind IPv6 → local SOCKS | `setup-proxy-pool.sh` + microsocks |
| `PROXY_URLS` | Infra (`/etc/skydiiv/proxy-pool.env`) |
| Round-robin proxy choice | Application |

## Capacity / out-of-capacity

Paid Ampere usually has better availability than Always Free. If `LaunchInstance` still fails:

1. Bump `availability_domain_index` (`1`, `2`, …).
2. Or temporarily use `VM.Standard.E4.Flex` (also paid flex).

## Terraform state

- Preferred: `TF_BACKEND_HCL` remote backend.
- Fallback: GitHub Actions cache (less durable).

## First-time local Terraform

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars
# edit values — keep enable_weekly_schedule=true for production
# cost_alert_email defaults to emmanuel.bergmann@icloud.com
terraform init -backend=false
terraform apply
terraform output instance_public_ip
terraform output enable_weekly_schedule
terraform output cost_limit_usd
terraform output budget_id
```
