#!/usr/bin/env bash
# Initialize Terraform with optional OCI Object Storage remote state.
#
# Local: set TF_BACKEND_HCL to a path, e.g. deploy/terraform/backend.hcl
#
# CI (recommended — avoids GitHub Actions eating double quotes in multiline secrets):
#   base64 < deploy/terraform/backend.hcl | gh secret set TF_BACKEND_HCL_B64 --env production
#
# CI (alternate — only when TF_BACKEND_HCL is passed via the step env: block, never
# inlined as ${{ secrets.TF_BACKEND_HCL }} inside a run: script):
#   gh secret set TF_BACKEND_HCL --env production < deploy/terraform/backend.hcl
#
# First-time migration from local state:
#   TF_BACKEND_MIGRATE=1 ./deploy/terraform-init.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${ROOT}/deploy/terraform"
cd "${TF_DIR}"

write_backend_hcl_from_env() {
  umask 077
  if [[ -n "${TF_BACKEND_HCL_B64:-}" ]]; then
    if ! printf '%s' "${TF_BACKEND_HCL_B64}" | base64 -d > backend.hcl 2>/dev/null; then
      echo "TF_BACKEND_HCL_B64 is not valid base64" >&2
      exit 1
    fi
    printf '%s\n' "${TF_DIR}/backend.hcl"
    return 0
  fi

  local cfg="${TF_BACKEND_HCL:-}"
  [[ -n "${cfg}" ]] || return 1

  # Multiline or HCL-shaped body — not a filesystem path.
  if [[ "${cfg}" == *$'\n'* ]] || [[ "${cfg}" =~ ^[[:space:]]*(#|bucket[[:space:]]*=) ]]; then
    printf '%s' "${cfg}" > backend.hcl
    [[ "${cfg}" == *$'\n' ]] || printf '\n' >> backend.hcl
    printf '%s\n' "${TF_DIR}/backend.hcl"
    return 0
  fi

  if [[ -f "${cfg}" ]]; then
    printf '%s\n' "${cfg}"
    return 0
  fi
  if [[ -f "${ROOT}/${cfg}" ]]; then
    printf '%s\n' "${ROOT}/${cfg}"
    return 0
  fi

  # Last resort: treat as inline HCL (single-line secrets are unlikely but valid).
  printf '%s' "${cfg}" > backend.hcl
  printf '\n' >> backend.hcl
  printf '%s\n' "${TF_DIR}/backend.hcl"
}

validate_backend_hcl() {
  local file="$1"
  if grep -E '^[[:space:]]*(bucket|key|region|endpoint|access_key|secret_key)[[:space:]]*=[[:space:]]*[^"'\''#]' "${file}"; then
    cat >&2 <<'EOF'
backend.hcl syntax error: string values must use double quotes.

If CI stripped the quotes, the workflow probably inlined the secret in a run:
script (printf "...${{ secrets.TF_BACKEND_HCL }}..."). Re-set using base64:

  base64 < deploy/terraform/backend.hcl | gh secret set TF_BACKEND_HCL_B64 --env production

Or ensure TF_BACKEND_HCL is only passed through the step env: block and read as
$TF_BACKEND_HCL in deploy/terraform-init.sh — never embedded in the script body.
EOF
    exit 1
  fi
}

if backend_config="$(write_backend_hcl_from_env)"; then
  validate_backend_hcl "${backend_config}"
  migrate=()
  if [[ "${TF_BACKEND_MIGRATE:-}" == "1" || "${TF_BACKEND_MIGRATE:-}" == "true" ]]; then
    migrate=(-migrate-state)
  fi
  terraform init -input=false -reconfigure "${migrate[@]}" -backend-config="${backend_config}"
else
  terraform init -input=false -backend=false
fi
