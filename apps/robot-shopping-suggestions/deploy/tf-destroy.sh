#!/usr/bin/env bash
# Destroy the robot Terraform stack in one of two modes:
#
#   soft (default) — tear down only cost-generating resources:
#                      Container Instance + NAT Gateway (private mode).
#                      Keeps free long-lived pieces: IAM (dynamic group /
#                      OCIR pull policy), budget + alert rules, VCN / IGW /
#                      subnet / routes / security lists / service gateway,
#                      and the Terraform-only OCIR policy wait.
#                      Next weekly create reuses them from remote state.
#
#   hard           — full `terraform destroy` of every managed resource.
#                      Use when you intentionally want a clean slate
#                      (tenancy IAM teardown, abandoning the stack, etc.).
#
# Usage:
#   ./deploy/tf-destroy.sh              # soft
#   ./deploy/tf-destroy.sh soft
#   ./deploy/tf-destroy.sh hard
#   TF_DESTROY_MODE=hard ./deploy/tf-destroy.sh
#
# Extra args after the mode are passed through to terraform destroy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${TF_DIR:-${ROOT}/deploy/terraform}"
CI_ADDRESS="oci_container_instances_container_instance.robot"

MODE="${TF_DESTROY_MODE:-soft}"
TF_ARGS=()

if [[ $# -gt 0 ]]; then
  case "$1" in
    soft|hard)
      MODE="$1"
      shift
      ;;
  esac
fi
TF_ARGS=("$@")

# Addresses that generate OCI cost while they exist. Everything else in this
# stack is free (VCN/IAM/budget) or Terraform-only (time_sleep).
is_billable_address() {
  case "$1" in
    oci_container_instances_container_instance.*|oci_core_nat_gateway.*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# FAILED/tainted CIs often cannot be deleted via the OCI work request; drop
# them from state so soft/hard destroy can finish the rest of the stack.
drop_unusable_container_instance() {
  terraform state list 2>/dev/null | grep -q "^${CI_ADDRESS}$" || return 0

  local unusable
  unusable="$(terraform show -json 2>/dev/null | python3 -c '
import json, sys
try:
    doc = json.load(sys.stdin)
except Exception:
    print("false")
    raise SystemExit
for resource in doc.get("values", {}).get("root_module", {}).get("resources", []):
    if resource.get("type") != "oci_container_instances_container_instance":
        continue
    if resource.get("tainted"):
        print("true")
        break
    if resource.get("values", {}).get("state") in {"FAILED", "INACTIVE", "DELETED"}:
        print("true")
        break
else:
    print("false")
' 2>/dev/null || echo false)"

  if [[ "${unusable}" == "true" ]]; then
    echo "==> Dropping unusable Container Instance from Terraform state"
    terraform state rm "${CI_ADDRESS}" >/dev/null 2>&1 || true
  fi
}

# Print -target flags for every billable address still in state (one line).
billable_target_flags() {
  local addr flags=()
  while IFS= read -r addr; do
    [[ -n "${addr}" ]] || continue
    if is_billable_address "${addr}"; then
      flags+=(-target="${addr}")
    fi
  done < <(terraform state list 2>/dev/null || true)

  if [[ "${#flags[@]}" -eq 0 ]]; then
    return 1
  fi
  printf '%s\n' "${flags[@]}"
}

cd "${TF_DIR}"

# Sync lifecycle state so FAILED CIs are visible before we decide what to drop.
terraform apply -refresh-only -auto-approve -input=false >/dev/null 2>&1 || true
drop_unusable_container_instance

case "${MODE}" in
  soft)
    target_flags=()
    while IFS= read -r flag; do
      [[ -n "${flag}" ]] || continue
      target_flags+=("${flag}")
    done < <(billable_target_flags || true)

    if [[ "${#target_flags[@]}" -eq 0 ]]; then
      echo "==> Soft destroy: no cost-generating resources in state — nothing to tear down"
      echo "    (IAM / budget / VCN kept for the next create)"
      exit 0
    fi

    echo "==> Soft destroy: removing cost-generating resources only"
    for flag in "${target_flags[@]}"; do
      echo "    - ${flag#-target=}"
    done
    echo "    Keeping free resources (IAM, budget, VCN/networking) in state"

    set +e
    terraform destroy -auto-approve -input=false "${target_flags[@]}" "${TF_ARGS[@]}"
    code=$?
    set -e
    if [[ "${code}" -ne 0 ]]; then
      echo "==> Soft destroy failed — dropping Container Instance from state and retrying" >&2
      terraform state rm "${CI_ADDRESS}" >/dev/null 2>&1 || true
      target_flags=()
      while IFS= read -r flag; do
        [[ -n "${flag}" ]] || continue
        target_flags+=("${flag}")
      done < <(billable_target_flags || true)
      if [[ "${#target_flags[@]}" -eq 0 ]]; then
        echo "==> Soft destroy: remaining billable resources cleared"
        exit 0
      fi
      terraform destroy -auto-approve -input=false "${target_flags[@]}" "${TF_ARGS[@]}"
    fi
    echo "==> Soft destroy complete — billable resources removed; free stack left for reuse"
    ;;

  hard)
    echo "==> Hard destroy: removing every managed resource (IAM, budget, VCN, compute)"
    set +e
    terraform destroy -auto-approve -input=false "${TF_ARGS[@]}"
    code=$?
    set -e
    if [[ "${code}" -ne 0 ]]; then
      echo "==> Hard destroy failed — dropping Container Instance from state and retrying" >&2
      terraform state rm "${CI_ADDRESS}" >/dev/null 2>&1 || true
      terraform destroy -auto-approve -input=false "${TF_ARGS[@]}"
    fi
    echo "==> Hard destroy complete — full stack removed"
    ;;

  *)
    echo "Unknown destroy mode: ${MODE} (expected soft|hard)" >&2
    exit 1
    ;;
esac
