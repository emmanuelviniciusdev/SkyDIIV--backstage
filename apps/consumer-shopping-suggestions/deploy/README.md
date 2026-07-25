# Deploy — Consumer Shopping Suggestions

Provisioning + deploy on **Oracle Cloud pay-as-you-go** compute (Ampere A1 Flex)
with an **ephemeral weekly stack**: create before the scrape window, **`terraform destroy`**
after — so idle cost for compute **and boot volume** is **$0**.

> On PAYG, **STOPPED** VMs still bill for the boot volume (~50 GB). Do **not** rely on
> OCI Resource Scheduler START/STOP for cost control.

## Cost model

| Mode | Billing |
|---|---|
| **Production (Thursday window)** | Stack exists only ~Thu 10:00–12:05 (`America/Sao_Paulo`). Outside that: **no VM / no boot volume**. |
| **Test / localhost `--test`** | You create on demand; VM left **RUNNING** — **destroy when done** or storage keeps billing. |
| **Push deploy (`production` mode)** | Apply + deploy smoke, then **`terraform destroy`** (no idle stack). |
| **Monthly ceiling** | Default **`$5.00` USD** — cost guard **`terraform destroy`** if Usage API MTD cost ≥ limit |

Default shape: `VM.Standard.A1.Flex` — **2 OCPU / 4 GB**. Boot volume default **50 GB** (OCI minimum).

Weekly GitHub Actions crons ([schedule-defaults.json](./schedule-defaults.json),
workflow `.github/workflows/weekly-consumer-shopping-suggestions.yml`):

| Action | Local (BRT) | UTC CRON |
|---|---|---|
| **Create + deploy** | Thursday 10:00 | `0 13 * * 4` |
| Scrape window | Thursday 11:00–12:00 | — |
| **Destroy stack** | Thursday 12:05 | `5 15 * * 4` |

```
Weekly GHA (production environment)
  Thu 10:00 BRT  terraform apply → START → SCP → remote-deploy.sh → leave RUNNING
  Thu 11:00–12:00  consumer polls Cloudflare Queues
  Thu 12:05 BRT  terraform destroy  (VM + boot volume + VCN + IPv6)

Push / localhost production mode
  terraform apply → deploy → terraform destroy

Localhost --test
  terraform apply → deploy → leave RUNNING
  → ./deploy/destroy-from-local.sh when finished

Daily GHA cost guard (12:00 UTC)
  oci_cost_guard.py → terraform destroy if MTD ≥ cost_limit_usd
```

Prefer secret **`TF_BACKEND_HCL`** so weekly create/destroy share the same Terraform state
(see [Terraform state](#terraform-state-tf_backend_hcl) below). Without it, Actions cache
is best-effort only.

## Modes (ephemeral vs test)

| | Production / weekly | Test (`--test` / staging default) |
|---|---|---|
| Stack lifetime | Create → ~2h → destroy | Until you destroy |
| After localhost `--production` | **`terraform destroy`** | — |
| After localhost `--test` | — | VM **RUNNING** (bills until destroy) |

### OCI naming

| Resource | Display name |
|---|---|
| VM (production) | `skydiiv-consumer-shopping-suggestions` |
| VM (staging) | `skydiiv-consumer-shopping-suggestions-staging` |
| VCN / IGW / subnet / budget / … | `${name_prefix}-…` (same prefix) |

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

## Localhost deploy

Use this to exercise the consumer outside the Thursday GHA window.

### Prerequisites

1. `deploy/terraform/terraform.tfvars` filled (see `terraform.tfvars.example`)
2. SSH key pair matching `ssh_public_key`
3. **`.env`** filled from `.env.example` (app secrets for dev and local deploy — see [docs/ENV.md](../docs/ENV.md))
4. Tools: `terraform`, `npm`, `ssh`/`scp`, `python3` (+ pip). The script installs the `oci` Python SDK if missing.

### Test deploy (leave RUNNING — destroy when done)

```bash
cd apps/consumer-shopping-suggestions
chmod +x deploy/*.sh

./deploy/deploy-from-local.sh --test \
  --ssh-key ~/.ssh/skydiiv-oci-css \
  --yes
```

What `--test` does:

1. `terraform apply`
2. **START**s the VM, builds, uploads, `remote-deploy.sh`
3. Leaves the VM **RUNNING** (PAYG boot volume bills until destroy)

When finished:

```bash
./deploy/destroy-from-local.sh --yes
```

Also check **Block Storage → Boot Volumes** in OCI for orphan volumes from old terminations.

### Ephemeral / production-like localhost deploy

```bash
./deploy/deploy-from-local.sh --production \
  --ssh-key ~/.ssh/skydiiv-oci-css \
  --yes
```

Apply + deploy, then **`terraform destroy`** (no idle storage). Thursday live traffic
uses the **Weekly** GitHub Actions workflow, not this path.

### Manual start / get (while a stack exists)

```bash
cd deploy/terraform
export OCI_INSTANCE_OCID="$(terraform output -raw instance_ocid)"
export OCI_REGION=us-ashburn-1
export OCI_API_PRIVATE_KEY_PATH=/Users/you/.oci/oci_api_key.pem
export OCI_TENANCY_OCID=...
export OCI_USER_OCID=...
export OCI_FINGERPRINT=...

python3 ../oci_instance_action.py START --wait
python3 ../oci_instance_action.py GET
# Prefer destroy over STOP on PAYG:
# ./deploy/destroy-from-local.sh --yes
```

### SSH / logs on the VM

Use [ssh-vm.sh](./ssh-vm.sh) (reads `instance_public_ip` and `ssh_user` from Terraform):

```bash
cd apps/consumer-shopping-suggestions

# Interactive shell
./deploy/ssh-vm.sh --ssh-key ~/.ssh/skydiiv-oci-css

# Recent consumer logs
./deploy/ssh-vm.sh logs

# Follow consumer logs
./deploy/ssh-vm.sh logs --follow

# Proxy pool logs
./deploy/ssh-vm.sh logs proxy --follow

# systemd status for consumer + proxy
./deploy/ssh-vm.sh status
```

Manual equivalent:

```bash
cd deploy/terraform
ssh -i ~/.ssh/skydiiv-oci-css ubuntu@"$(terraform output -raw instance_public_ip)"
sudo journalctl -u consumer-shopping-suggestions -f
sudo journalctl -u skydiiv-proxy-pool -f
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
CF_SCRAPE_SHOPP_SUGG_QUEUE_ID=...
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
| Paid VM + boot volume | Terraform (`oci_core_instance`) — destroyed with the stack |
| Thursday create / destroy | GitHub Actions `weekly-consumer-shopping-suggestions.yml` |
| Monthly budget + email alerts | Terraform (`oci_budget_budget`) when enabled |
| Hard cost kill (`terraform destroy`) | `oci_cost_guard.py` + daily GHA cron |
| Public IPv6 pool | Terraform (`oci_core_ipv6`) |
| Bind IPv6 → local SOCKS | `setup-proxy-pool.sh` + microsocks |
| `PROXY_URLS` | Infra (`/etc/skydiiv/proxy-pool.env`) |
| Round-robin proxy choice | Application |

## Capacity / out-of-capacity

Paid Ampere usually has better availability than Always Free. If `LaunchInstance` still fails:

1. Bump `availability_domain_index` (`1`, `2`, …).
2. Or temporarily use `VM.Standard.E4.Flex` (also paid flex).

## Terraform state (`TF_BACKEND_HCL`)

GitHub secret **`TF_BACKEND_HCL`** is the contents of a Terraform `backend.hcl` file.
Workflows write it to disk and run `terraform init -backend-config=backend.hcl` so
**create** and **destroy** jobs share the same state.

Typical options:

| Backend | Cost on PAYG? | Notes |
|---|---|---|
| **GitHub Actions cache** (current fallback) | Free | Works for weekly create/destroy if cache hits; can miss / diverge |
| **Cloudflare R2** (S3-compatible) | Usually **$0** on free tier for tiny state (~KBs) | Good fit if you already use CF; no OCI storage cost |
| **OCI Object Storage** | Often covered by Always Free **20 GB** object storage; beyond that, small PAYG charge | Same cloud as the VM; not free if you exceed Always Free |

## First-time local Terraform

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars
# edit values — cost_alert_email defaults to emmanuel.bergmann@icloud.com
terraform init -backend=false
terraform apply
terraform output instance_public_ip
terraform output name_prefix   # skydiiv-consumer-shopping-suggestions
terraform output cost_limit_usd
terraform output budget_id
# when finished testing:
cd .. && ./destroy-from-local.sh --yes
```
