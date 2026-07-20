# Deploy — Consumer Shopping Suggestions

Fully automated provisioning + deploy on **Oracle Always Free** compute.

```
GitHub Actions
  ├─ CI (lint / test / build)
  ├─ Terraform
  │    ├─ VCN + subnet (IPv4 + IPv6)
  │    ├─ Internet Gateway + routes + security list
  │    ├─ Always Free VM (Ampere A1 Flex by default)
  │    └─ Extra IPv6 addresses for egress rotation
  ├─ Wait for SSH
  ├─ SCP release + ipv6-addresses.txt
  └─ SSH remote-deploy.sh
        ├─ setup-proxy-pool.sh  (microsocks + systemd + PROXY_URLS)
        ├─ merge-env.sh
        ├─ npm ci + camoufox fetch
        └─ systemctl restart consumer
```

## Always Free shapes

| Shape | Default? | Notes |
|---|---|---|
| `VM.Standard.A1.Flex` (Ampere ARM) | **Yes** | Free accounts: **2 OCPU / 12 GB**. Paid Always Free A1 entitlement: up to 4 / 24. |
| `VM.Standard.E2.1.Micro` (AMD) | No | Up to 2 micro instances per tenancy. |

Defaults stay inside free-account Ampere limits (`INSTANCE_OCPUS=2`, `INSTANCE_MEMORY_GB=12`). Override via GitHub Environment variables only if your tenancy allows it.

Compute **must** be created in the tenancy **home region**.

## One-time prerequisites (account only)

1. Oracle Cloud account with API key (user OCID, fingerprint, private key).
2. GitHub Environment secrets/vars configured (below).
3. Prefer a **remote Terraform backend** (`TF_BACKEND_HCL`) so state survives CI cache eviction.

No manual VM, VCN, or IPv6 setup is required after that.

## GitHub Environment configuration

### Secrets

| Secret | Purpose |
|---|---|
| `OCI_TENANCY_OCID` | Tenancy OCID |
| `OCI_USER_OCID` | API user OCID |
| `OCI_FINGERPRINT` | API key fingerprint |
| `OCI_API_PRIVATE_KEY` | PEM private key for OCI API |
| `OCI_REGION` | Home region (e.g. `sa-saopaulo-1`) |
| `OCI_COMPARTMENT_OCID` | Target compartment (often the tenancy OCID) |
| `SSH_PUBLIC_KEY` | Public key installed on the VM by Terraform |
| `SSH_PRIVATE_KEY` | Matching private key used by GitHub Actions SCP/SSH |
| `CONSUMER_SHOPPING_SUGGESTIONS_ENV` | App secrets (Redis, etc.) — **do not** set `PROXY_URLS` |
| `TF_BACKEND_HCL` | Optional remote Terraform backend config |

`ORACLE_VM_HOST`, `ORACLE_VM_USER`, and `OCI_INSTANCE_OCID` are **no longer required** — Terraform creates the VM and exports the public IP / SSH user.

### Variables

| Variable | Default | Purpose |
|---|---|---|
| `IPV6_COUNT` | `4` | Extra IPv6 addresses for egress rotation |
| `PROXY_BASE_PORT` | `11080` | First local SOCKS port |
| `INSTANCE_SHAPE` | `VM.Standard.A1.Flex` | Always Free–eligible shape |
| `INSTANCE_OCPUS` | `2` | Ampere OCPUs (max 2 on free accounts) |
| `INSTANCE_MEMORY_GB` | `12` | Ampere memory GB (max 12 on free accounts) |
| `AVAILABILITY_DOMAIN_INDEX` | `0` | Change if Ampere capacity is exhausted in AD 0 |

### `CONSUMER_SHOPPING_SUGGESTIONS_ENV` example

```env
REDIS_URL=redis://...
REDIS_STREAM_KEY=shopping-suggestions
REDIS_CONSUMER_GROUP=shopping-suggestions-consumers
REDIS_CONSUMER_NAME=consumer-1
CONSUMER_CONCURRENCY=10
LOG_LEVEL=INFO
CAMOUFOX_HEADLESS=true
```

## What each layer owns

| Concern | Owner |
|---|---|
| VCN / subnet / IGW / security | Terraform |
| Always Free VM | Terraform (`oci_core_instance`) |
| Public IPv6 pool | Terraform (`oci_core_ipv6`) |
| Bind IPv6 → local SOCKS | `setup-proxy-pool.sh` + microsocks |
| `PROXY_URLS=socks5://...` | Infra (`/etc/skydiiv/proxy-pool.env`) |
| Round-robin proxy choice | Application |

## Capacity / out-of-capacity

Ampere Always Free capacity is often scarce. If `terraform apply` fails with out-of-capacity:

1. Set `AVAILABILITY_DOMAIN_INDEX` to another AD (`1`, `2`, …).
2. Or temporarily set `INSTANCE_SHAPE=VM.Standard.E2.1.Micro` (and lower image to a matching x86 Ubuntu if needed).
3. Re-run the workflow.

## Terraform state

- Preferred: `TF_BACKEND_HCL` pointing at Object Storage / S3 / Terraform Cloud.
- Fallback: GitHub Actions cache per environment (less durable).

## Local Terraform (optional)

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars
# edit values
terraform init
terraform apply
terraform output instance_public_ip
terraform output -raw ipv6_pool_file
```
