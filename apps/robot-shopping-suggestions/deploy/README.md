# Deploy — Robot Shopping Suggestions

The robot runs as an **ephemeral OCI Container Instance** built from an OCIR
image, on pay-as-you-go. There is no boot volume and no long-lived compute:
creating the stack starts the robot, deleting it stops the robot.

## Workflows

| Workflow | Trigger | Does |
|---|---|---|
| `weekly-…` (create) | cron `0 10 * * 0` (Sun 07:00 BRT) · `workflow_dispatch action=create` | lint/test/build → build & push OCIR image → cost gate → `terraform apply` |
| `weekly-…` (destroy) | cron `0 12 * * 0` (Sun 09:00 BRT) · `workflow_dispatch action=destroy` | `terraform destroy` — **absolute authority** → purge OCIR image versions |
| `cost-guard-…` | daily `0 12 * * *` · `workflow_dispatch` (`dry_run`) | `terraform destroy` when MTD spend ≥ limit |
| `deploy-…` | PR / push to `main`, `staging` · `workflow_dispatch` | CI (lint, test, build); optionally pushes an OCIR image without creating infra |

Files: `.github/workflows/{weekly,cost-guard,deploy}-robot-shopping-suggestions.yml`.

Schedule constants: [schedule-defaults.json](./schedule-defaults.json). America/Sao_Paulo
is UTC-3 year-round, so the CRONs never drift.

```
Sun 07:00 BRT  cost gate → build+push OCIR → terraform apply → Container Instance ACTIVE
               robot drains CF Queues (2 at a time) → self-deletes the instance
Sun 09:00 BRT  terraform destroy (Container Instance + VCN + budget), absolute
               → purge OCIR image versions (no registry storage between runs)
Daily 12:00 UTC  cost guard → terraform destroy if MTD ≥ cost_limit_usd
```

## Turning the stack on and off manually

```bash
# GitHub Actions
gh workflow run weekly-robot-shopping-suggestions.yml -f action=create
gh workflow run weekly-robot-shopping-suggestions.yml -f action=destroy

# From your machine (local Terraform state)
./deploy/deploy-from-local.sh apply               # build+push image, then apply
./deploy/deploy-from-local.sh apply --skip-build  # terraform only
./deploy/deploy-from-local.sh destroy             # apply/destroy with state repair
./deploy/destroy-from-local.sh --yes              # plain terraform destroy
```

Local and CI share Terraform state when `TF_BACKEND_HCL` points at an OCI
Object Storage bucket (S3-compatible API). Without it, CI falls back to state in
the Actions cache and local runs keep `terraform.tfstate` on disk.

### Local setup (once)

```bash
cd apps/robot-shopping-suggestions
cp deploy/terraform/terraform.tfvars.example deploy/terraform/terraform.tfvars  # OCI ids
cp deploy/local.env.example deploy/local.env                                    # OCIR image + credentials
cp .env.example .env                                                            # app secrets
cp deploy/terraform/backend.hcl.example deploy/terraform/backend.hcl          # remote state (optional)
```

Put the OCI API private key wherever `private_key_path` in `terraform.tfvars`
points (`~/.oci/oci_api_key.pem`, or `oci_api_key.pem` next to the tfvars) — the
same path is reused by the cost gate.

| File | Purpose |
|---|---|
| `deploy/terraform/terraform.tfvars` | OCI tenancy/user/region/compartment + `private_key_path` |
| `deploy/local.env` | Image URL, OCIR username/token, optional `network_mode`, `GITHUB_TOKEN`, `TF_BACKEND_HCL` |
| `deploy/terraform/backend.hcl` | Object Storage backend config (gitignored) |
| `.env` | App secrets — converted to `TF_VAR_robot_env` by `deploy/build-robot-env.py` |

### Remote Terraform state

1. Fill in `deploy/terraform/backend.hcl` from `backend.hcl.example` (bucket,
   namespace endpoint, customer secret keys).
2. Local: add to `deploy/local.env`:
   ```bash
   TF_BACKEND_HCL=deploy/terraform/backend.hcl
   ```
3. GitHub (`production` environment) — use **base64** so Actions does not strip
   quotes from multiline secrets:
   ```bash
   base64 < deploy/terraform/backend.hcl | tr -d '\n' | \
     gh secret set TF_BACKEND_HCL_B64 --env production
   ```
   Keep the `skip_*` flags from `backend.hcl.example`: the S3 driver otherwise
   makes AWS-only calls (`skip_requesting_account_id`) and uploads with
   `aws-chunked` encoding, which OCI rejects with `501 NotImplemented`
   (`skip_s3_checksum`). `terraform-init.sh` also re-quotes string keys if Actions
   strips `"`. Do not embed secrets inside a `run:` script body.
4. If you already have a local `terraform.tfstate`, migrate once:
   ```bash
   TF_BACKEND_MIGRATE=1 ./deploy/terraform-init.sh
   ```

`deploy/terraform-init.sh` is used by local scripts and CI. State key defaults to
`robot-shopping-suggestions/production.tfstate` — use a different `key` per
environment if needed.

The OCIR repo `robot-shopping-suggestions` must exist in the tenancy (the first
push may create it). The Docker build downloads Camoufox from GitHub; if
`camoufox-js fetch` hits rate limits, set `GITHUB_TOKEN=$(gh auth token)` in
`deploy/local.env`.

## Cost

| Mode | Billing |
|---|---|
| Sunday window | Stack exists ~07:00–09:00 BRT; the robot self-deletes after the drain |
| Outside the window | No Container Instance, no VCN → **$0** |
| Monthly ceiling | **$5.00** USD ([cost-limit-defaults.json](./cost-limit-defaults.json)) |

Default shape: `CI.Standard.A1.Flex` — 2 OCPU / 4 GB.

| Layer | What it does |
|---|---|
| **OCI Budget** (`budget.tf`) | Monthly absolute amount; emails at 80% and 100% — alerts only |
| **Cost guard** (`oci_cost_guard.py`) | Usage API MTD ≥ limit → `terraform destroy` (daily) |
| **Cost gate** (`--check-only`) | Runs before every apply; exit `10` refuses to create new infra |

Usage API data can lag ~24h, so the kill is eventual rather than instantaneous.

## Secrets / variables

`production` environment secrets:

| Secret | Purpose |
|---|---|
| `OCI_TENANCY_OCID` / `OCI_USER_OCID` / `OCI_FINGERPRINT` / `OCI_API_PRIVATE_KEY` / `OCI_REGION` / `OCI_COMPARTMENT_OCID` | OCI identity for Terraform, the cost guard and self-delete |
| `OCIR_NAMESPACE` / `OCIR_USERNAME` / `OCIR_AUTH_TOKEN` | Push/pull the robot image |
| `ROBOT_SHOPPING_SUGGESTIONS_ENV` | App `.env` → `TF_VAR_robot_env` ([ENV.md](../docs/ENV.md)) |
| `COST_ALERT_EMAIL` | Budget alert recipient |
| `TF_BACKEND_HCL_B64` | Remote Terraform state (`base64 < backend.hcl`) — preferred in CI |
| `TF_BACKEND_HCL` | Remote Terraform state (raw HCL; only safe via step `env:` block) |

Repository/environment variables: `CONTAINER_OCPUS` (`2`), `CONTAINER_MEMORY_GB`
(`4`), `AVAILABILITY_DOMAIN_INDEX` (`0`), `COST_LIMIT_USD` (`5`),
`ENABLE_COST_LIMIT` (`true`).

## Networking

`network_mode` decides how the Container Instance reaches the registry:

| Mode | Topology | Cost |
|---|---|---|
| `public` (default) | Public subnet + Internet Gateway + ephemeral public IP | no gateway charge |
| `private` | Private subnet + NAT Gateway + Service Gateway (All Services) | NAT ~$0.025/h |

The modes are mutually exclusive: OCI rejects a route table that mixes an
Internet Gateway default route with a Service Gateway "All Services" route.

The stack is **IPv4 only** — Enjoei, Cloudflare Queues, Postgres, Redis and the
OCI API are all reachable over IPv4, so dual-stack would only add `::/0`
blackhole risk. In `public` mode the instance has a public IP but the security
list declares no ingress rules, so nothing inbound is reachable; stateful egress
still returns scrape responses.

Camoufox egresses directly in both modes. `PROXY_URLS` must be empty or point at
an external proxy — a loopback value is rejected at plan time, since the
container runs no local SOCKS listener.

## OCIR pull authorization

Container Instances authenticate to Container Registry with their **own resource
principal**, not with `image_pull_secrets` — that field is only attached for
external registries such as Docker Hub or GHCR. A private OCIR image therefore
needs a dynamic group plus a `read repos` policy, both created by
`deploy/terraform/iam.tf` (BASIC pull secrets are intentionally omitted for
`*.ocir.io` image URLs so a bad secret cannot mask the resource-principal path):

```
ALL {resource.type='computecontainerinstance', resource.compartment.id = '<compartment>'}
Allow dynamic-group skydiiv-robot-shopping-suggestions-ci-dg to read repos in tenancy
```

Both are tenancy-scoped, so the applying identity must be a tenancy
administrator. Set `create_ocir_pull_policy = false` if they are managed
out-of-band. Because IAM is eventually consistent, the Container Instance waits
`ocir_policy_propagation_wait` (default 90s) after the policy is created — an
unauthorized pull is not retried, it fails the whole apply.

The dynamic group and OCIR pull policy are **imported into state** when they
already exist (lost state / first remote-backend run), then reconciled so the
matching rule always targets `compartment_ocid`. The monthly budget is still
looked up and adopted when present — OCI allows only one budget per target
compartment, and budgets are free. `terraform destroy` removes the managed
group and policy; an adopted budget is left in place. Configure
`TF_BACKEND_HCL` / `TF_BACKEND_HCL_B64` so CI keeps durable state across runs.

### Debugging image-pull failures

`A container's image could not be pulled due to inadequate network configuration`
is a single generic message covering routing **and** registry-authorization
problems, so it routinely points at the wrong subsystem. Bisect it:

```bash
./deploy/deploy-from-local.sh apply --public-image  # Docker Hub, no pull secret
./deploy/deploy-from-local.sh apply --smoke-test    # busybox in OCIR
```

If `--public-image` reaches `ACTIVE` the VCN is fine and the problem is OCIR
authorization — check the dynamic group and policy above before touching
gateways, route tables or `ocir_registry_endpoint`.

OCIR answers on both the region id (`us-ashburn-1.ocir.io`) and the region key
(`iad.ocir.io`), but this tenancy only pulls successfully from the region-id
host, so CI and `deploy/local.env` must both tag images with
`${OCI_REGION}.ocir.io`. Docker credentials are stored per host, so the
`docker login` in the workflow targets that same host.

## OCIR storage

Registry storage is billed continuously, and every create pushes a new image
version (`:<sha>` plus `:latest`), so versions accumulate between runs. The
destroy job deletes them all — the next create pushes a fresh image anyway:

```bash
python3 deploy/ocir_purge.py --dry-run   # list what would be deleted
python3 deploy/ocir_purge.py             # delete every version
python3 deploy/ocir_purge.py --keep 1    # keep the newest version
```

It uses the same OCI credentials as the cost guard and needs `pip install oci`.

## Self-delete vs destroy

1. Drain finishes → the robot `DELETE`s its own Container Instance (compute
   billing stops; the VCN is free and stays).
2. Sunday 09:00 BRT `terraform destroy` removes the VCN and any remaining state,
   regardless of queue depth.
3. The cost guard is the safety net if either path fails while spend ≥ limit.

A Container Instance is only deletable from `ACTIVE`, and a drain over an empty
queue finishes in about a second — well before OCI promotes it out of
`CREATING`. The robot waits for `ACTIVE` and then lingers
`SELF_DELETE_ACTIVE_GRACE_MS` (default 120s) so the in-flight `terraform apply`
can observe `ACTIVE` too.

That linger is best-effort: Terraform's create-wait polls roughly once a minute
and can still miss the window. `deploy/tf-apply.sh` wraps the apply and treats
`unexpected state: DELETED|DELETING|INACTIVE|UPDATING` as success, because those
states are only reachable once the container has pulled, run and exited — it
then drops the resource from state. Pull and authorization problems arrive as
`Work Request error` instead and still fail the apply.
