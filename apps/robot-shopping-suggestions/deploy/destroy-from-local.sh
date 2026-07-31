#!/usr/bin/env bash
# Destroy the robot Terraform stack (Container Instance + VCN + budget).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${ROOT}/deploy/terraform"
YES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=true; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ "${YES}" != "true" ]]; then
  echo "This will terraform destroy the robot stack. Re-run with --yes to confirm." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "${ROOT}/deploy/local-deploy-env.sh"

cd "${TF_DIR}"
if [[ ! -f terraform.tfstate ]] && [[ -z "${TF_BACKEND_HCL:-}" ]]; then
  echo "No local terraform.tfstate — ensure remote backend is configured if used." >&2
fi

terraform destroy -auto-approve -input=false
echo "Robot stack destroyed."
