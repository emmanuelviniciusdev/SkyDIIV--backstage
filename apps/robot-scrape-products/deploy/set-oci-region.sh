#!/usr/bin/env bash
# Point the robot stack at another OCI region (local files, optional GitHub secret).
#
# Does not terraform apply. Hard-destroy the *current* region first — changing
# region with resources still in state splits old OCIDs across a new provider.
#
# Usage:
#   ./deploy/set-oci-region.sh sa-saopaulo-1
#   ./deploy/set-oci-region.sh sa-saopaulo-1 --github
#   ./deploy/set-oci-region.sh sa-saopaulo-1 --github --subscribe
#   ./deploy/set-oci-region.sh us-ashburn-1 --github --force
#
# Writes:
#   deploy/terraform/terraform.tfvars  region = "…"
#   deploy/local.env                   TF_VAR_container_image_url host
# Does not touch backend.hcl (Object Storage state can stay in the home region).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TFVARS="${ROOT}/deploy/terraform/terraform.tfvars"
LOCAL_ENV="${ROOT}/deploy/local.env"
GH_ENV="production"

REGION=""
DO_GITHUB=false
DO_SUBSCRIBE=false
FORCE=false
SKIP_STATE_CHECK=false

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --github) DO_GITHUB=true; shift ;;
    --subscribe) DO_SUBSCRIBE=true; shift ;;
    --force) FORCE=true; shift ;;
    --skip-state-check) SKIP_STATE_CHECK=true; shift ;;
    --env) GH_ENV="${2:?}"; shift 2 ;;
    -*)
      echo "Unknown arg: $1" >&2
      usage 1
      ;;
    *)
      if [[ -n "${REGION}" ]]; then
        echo "Unexpected extra argument: $1" >&2
        usage 1
      fi
      REGION="$1"
      shift
      ;;
  esac
done

if [[ -z "${REGION}" ]]; then
  echo "Usage: $0 <region> [--github] [--subscribe] [--force] [--skip-state-check]" >&2
  echo "Example: $0 sa-saopaulo-1 --github" >&2
  exit 1
fi

if [[ ! "${REGION}" =~ ^[a-z]{2}-[a-z0-9-]+-[0-9]+$ ]]; then
  echo "Invalid OCI region id: ${REGION}" >&2
  echo "Expected like us-ashburn-1 or sa-saopaulo-1" >&2
  exit 1
fi

if [[ ! -f "${TFVARS}" ]]; then
  echo "Missing ${TFVARS} — copy from terraform.tfvars.example" >&2
  exit 1
fi

check_state_empty() {
  if [[ "${SKIP_STATE_CHECK}" == "true" ]]; then
    echo "==> Skipping Terraform state check"
    return 0
  fi
  if [[ "${FORCE}" == "true" ]]; then
    echo "==> --force: not requiring an empty Terraform state"
    return 0
  fi

  if [[ -z "${TF_VAR_robot_env:-}" || "${TF_VAR_robot_env}" == '{}}' ]]; then
    export TF_VAR_robot_env='{}'
  fi
  "${ROOT}/deploy/terraform-init.sh"
  local leftover
  leftover="$(
    cd "${ROOT}/deploy/terraform"
    terraform state list 2>/dev/null || true
  )"
  if [[ -n "${leftover}" ]]; then
    echo "Terraform state is not empty. Hard-destroy the current region first:" >&2
    echo "  export TF_VAR_robot_env='{}'   # if .env is missing" >&2
    echo "  ./deploy/deploy-from-local.sh destroy --hard" >&2
    echo "Then re-run this script. Pass --force only if you know state matches ${REGION}." >&2
    echo "--- state ---" >&2
    echo "${leftover}" >&2
    exit 1
  fi
  echo "==> Terraform state is empty"
}

rewrite_files() {
  python3 - "${TFVARS}" "${LOCAL_ENV}" "${REGION}" <<'PY'
from pathlib import Path
import re
import sys

tfvars_path, local_env_path, region = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]

text = tfvars_path.read_text()
if re.search(r"(?m)^\s*region\s*=", text):
    new, n = re.subn(
        r'(?m)^(\s*region\s*=\s*)"[^"]*"',
        rf'\1"{region}"',
        text,
        count=1,
    )
    if n != 1:
        raise SystemExit(f"Could not replace region= in {tfvars_path}")
    text = new
else:
    text = f'region = "{region}"\n' + text
tfvars_path.write_text(text)
print(f"Wrote {tfvars_path} region = {region!r}")

if not local_env_path.is_file():
    print(f"No {local_env_path} — skip OCIR image URL", file=sys.stderr)
    raise SystemExit(0)

env = local_env_path.read_text()
updated, n = re.subn(
    r"(TF_VAR_container_image_url=)([\"']?)[a-z0-9-]+\.ocir\.io",
    rf"\1\2{region}.ocir.io",
    env,
    count=1,
)
if n != 1:
    raise SystemExit(
        f"Could not rewrite TF_VAR_container_image_url in {local_env_path}"
    )
local_env_path.write_text(updated)
for line in updated.splitlines():
    if line.startswith("TF_VAR_container_image_url="):
        print(f"Wrote {line}")
        break
PY
}

subscribe_region() {
  echo "==> Subscribing tenancy to ${REGION}"
  local key
  key="$(
    oci iam region list --all \
      --query "data[?name=='${REGION}'].key | [0]" \
      --raw-output
  )"
  if [[ -z "${key}" || "${key}" == "null" ]]; then
    echo "Could not resolve region key for ${REGION} (oci iam region list)" >&2
    exit 1
  fi
  if oci iam region-subscription create --region-key "${key}"; then
    echo "    subscribed ${REGION} (${key}) — wait until Console shows READY"
    return 0
  fi
  echo "    create returned non-zero (often already subscribed). Listing:" >&2
  oci iam region-subscription list --output table
}

set_github_secret() {
  echo "==> gh secret set OCI_REGION=${REGION} --env ${GH_ENV}"
  printf '%s' "${REGION}" | gh secret set OCI_REGION --env "${GH_ENV}"
}

check_state_empty
rewrite_files
if [[ "${DO_SUBSCRIBE}" == "true" ]]; then
  subscribe_region
fi
if [[ "${DO_GITHUB}" == "true" ]]; then
  set_github_secret
fi

cat <<EOF

Region is now ${REGION}. Next:

  # GitHub weekly create (uses secrets.OCI_REGION)
  gh workflow run weekly-robot-scrape-products.yml -f action=create

  # or local (needs a filled .env)
  ./deploy/deploy-from-local.sh apply

backend.hcl was not changed. Confirm Ampere A1 exists in ${REGION} before apply.
EOF
