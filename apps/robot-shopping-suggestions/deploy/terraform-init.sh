#!/usr/bin/env bash
# Initialize Terraform with optional OCI Object Storage remote state.
#
# Set TF_BACKEND_HCL to either:
#   - a path to backend.hcl (local), e.g. deploy/terraform/backend.hcl
#   - the raw HCL body (GitHub Actions writes the secret to backend.hcl)
#
# First-time migration from local state:
#   TF_BACKEND_MIGRATE=1 ./deploy/terraform-init.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${ROOT}/deploy/terraform"
cd "${TF_DIR}"

resolve_backend_config() {
  local cfg="${TF_BACKEND_HCL:-}"
  [[ -n "${cfg}" ]] || return 1

  if [[ -f "${cfg}" ]]; then
    printf '%s\n' "${cfg}"
    return 0
  fi
  if [[ -f "${ROOT}/${cfg}" ]]; then
    printf '%s\n' "${ROOT}/${cfg}"
    return 0
  fi

  umask 077
  printf '%s\n' "${cfg}" > backend.hcl
  printf '%s\n' "${TF_DIR}/backend.hcl"
}

if backend_config="$(resolve_backend_config)"; then
  migrate=()
  if [[ "${TF_BACKEND_MIGRATE:-}" == "1" || "${TF_BACKEND_MIGRATE:-}" == "true" ]]; then
    migrate=(-migrate-state)
  fi
  terraform init -input=false -reconfigure "${migrate[@]}" -backend-config="${backend_config}"
else
  terraform init -input=false -backend=false
fi
