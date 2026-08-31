#!/usr/bin/env bash
# Destroy the robot Terraform stack.
#
#   soft (default) — billable resources only (Container Instance + NAT)
#   hard           — every managed resource (IAM, budget, VCN, compute)
#
# Usage:
#   ./deploy/destroy-from-local.sh --yes
#   ./deploy/destroy-from-local.sh --yes --hard
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
YES=false
MODE=soft

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=true; shift ;;
    --hard) MODE=hard; shift ;;
    --soft) MODE=soft; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ "${YES}" != "true" ]]; then
  echo "This will terraform destroy (${MODE}). Re-run with --yes to confirm." >&2
  echo "  Soft (default): cost-generating resources only" >&2
  echo "  Hard (--hard):  full stack including free IAM/budget/VCN" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "${ROOT}/deploy/local-deploy-env.sh"

"${ROOT}/deploy/terraform-init.sh"
"${ROOT}/deploy/tf-destroy.sh" "${MODE}"
echo "Robot stack destroy (${MODE}) finished."
