#!/usr/bin/env bash
# Verify robot OCI infra is gone in one region after hard destroy.
#
# Usage:
#   ./deploy/verify-oci-hard-destroy.sh sa-saopaulo-1
#   ./deploy/verify-oci-hard-destroy.sh sa-saopaulo-1 --include-tenancy
#   ./deploy/verify-oci-hard-destroy.sh sa-saopaulo-1 --skip-ocir
#
# Loads OCI ids from deploy/terraform/terraform.tfvars (same as other deploy scripts).
# Exit 0 = clean, 2 = leftovers, 1 = error.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TFVARS="${ROOT}/deploy/terraform/terraform.tfvars"

if [[ $# -lt 1 || "$1" == "-h" || "$1" == "--help" ]]; then
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

REGION="$1"
shift

if [[ ! "${REGION}" =~ ^[a-z]{2}-[a-z0-9-]+-[0-9]+$ ]]; then
  echo "Invalid OCI region id: ${REGION}" >&2
  echo "Expected like sa-saopaulo-1 or us-ashburn-1" >&2
  exit 1
fi

if [[ -f "${TFVARS}" ]]; then
  while IFS= read -r line; do
    [[ -n "${line}" ]] && eval "${line}"
  done < <(python3 "${ROOT}/deploy/export-tfvars-oci-env.py" "${TFVARS}")
fi

export OCI_API_PRIVATE_KEY_PATH="${OCI_API_PRIVATE_KEY_PATH:-${ROOT}/deploy/terraform/oci_api_key.pem}"

exec python3 "${ROOT}/deploy/verify_oci_hard_destroy.py" --region "${REGION}" "$@"
