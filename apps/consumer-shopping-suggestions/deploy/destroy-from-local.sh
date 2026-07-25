#!/usr/bin/env bash
# Destroy the consumer OCI Terraform stack (VM, boot volume, VCN, IPv6, budget).
# Use after --test deploys so PAYG storage does not keep billing.
#
# Example:
#   ./deploy/destroy-from-local.sh --yes
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${ROOT_DIR}/deploy/terraform"
AUTO_APPROVE=0

usage() {
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) AUTO_APPROVE=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown arg: $1" >&2; usage 1 ;;
  esac
done

if [[ ! -f "${TF_DIR}/terraform.tfvars" ]]; then
  echo "Missing ${TF_DIR}/terraform.tfvars" >&2
  exit 1
fi

log() { echo "==> $*"; }

cd "${TF_DIR}"

if ! terraform output -raw instance_ocid >/dev/null 2>&1; then
  # Still attempt destroy if state has other resources
  if ! terraform state list >/dev/null 2>&1 || [[ -z "$(terraform state list 2>/dev/null || true)" ]]; then
    log "No Terraform state / outputs — nothing to destroy"
    exit 0
  fi
fi

log "Terraform destroy"
DESTROY_FLAGS=(-input=false)
if [[ "${AUTO_APPROVE}" -eq 1 ]]; then
  DESTROY_FLAGS+=(-auto-approve)
fi
terraform destroy "${DESTROY_FLAGS[@]}"
log "Stack destroyed — no VM / boot volume should remain for this workspace"
