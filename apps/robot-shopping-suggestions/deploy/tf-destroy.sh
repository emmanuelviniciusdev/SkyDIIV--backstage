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
# Hard destroy is two-phase: clear the Container Instance (and wait for its
# subnet VNIC to release) before destroying networking. Otherwise OCI returns
# 409 Conflict on DeleteSubnet while the CI VNIC still references the subnet.
# Retries force-delete via the OCI API — never `state rm` alone, which orphans
# the VNIC and blocks the rest of the stack forever.
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
CLEAR_SCRIPT="${ROOT}/deploy/oci_clear_robot_compute.py"
# How long to wait for CI delete + subnet private-IP drain before giving up.
VNIC_CLEAR_TIMEOUT_SECONDS="${VNIC_CLEAR_TIMEOUT_SECONDS:-600}"

# shellcheck disable=SC1091
source "${ROOT}/deploy/oci-s3-backend-env.sh"

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

ci_ocid_from_state() {
  terraform show -json 2>/dev/null | python3 -c '
import json, sys
try:
    doc = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
for resource in doc.get("values", {}).get("root_module", {}).get("resources", []):
    if resource.get("address") == "'"${CI_ADDRESS}"'" or (
        resource.get("type") == "oci_container_instances_container_instance"
        and resource.get("name") == "robot"
    ):
        ocid = (resource.get("values") or {}).get("id") or ""
        if isinstance(ocid, str) and ocid.startswith("ocid1."):
            print(ocid, end="")
        break
' 2>/dev/null || true
}

subnet_id_from_state() {
  terraform show -json 2>/dev/null | python3 -c '
import json, sys
try:
    doc = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
resources = doc.get("values", {}).get("root_module", {}).get("resources", [])
# Prefer the subnet the CI actually used; fall back to public then private.
ci_subnet = ""
for resource in resources:
    if resource.get("type") == "oci_container_instances_container_instance":
        vnics = (resource.get("values") or {}).get("vnics") or []
        if vnics:
            ci_subnet = vnics[0].get("subnet_id") or ""
            break
if isinstance(ci_subnet, str) and ci_subnet.startswith("ocid1."):
    print(ci_subnet, end="")
    raise SystemExit(0)
for preferred in ("public", "private"):
    for resource in resources:
        if resource.get("type") != "oci_core_subnet":
            continue
        if resource.get("name") != preferred:
            continue
        ocid = (resource.get("values") or {}).get("id") or ""
        if isinstance(ocid, str) and ocid.startswith("ocid1."):
            print(ocid, end="")
            raise SystemExit(0)
' 2>/dev/null || true
}

# Resolve absolute path for the API key (TF_VAR path is relative to TF_DIR).
resolve_oci_key_path() {
  local key_path="${OCI_API_PRIVATE_KEY_PATH:-${TF_VAR_private_key_path:-}}"
  if [[ -n "${key_path}" && ! "${key_path}" = /* ]]; then
    key_path="${TF_DIR}/${key_path}"
  fi
  printf '%s' "${key_path}"
}

# API-delete robot CIs and wait until the subnet has no private IPs.
# Prefer this over bare `terraform state rm`, which orphans the VNIC.
clear_robot_compute() {
  local ci_ocid="${1:-}"
  local subnet_id="${2:-}"
  local key_path
  key_path="$(resolve_oci_key_path)"

  if [[ -z "${ci_ocid}" ]]; then
    ci_ocid="$(ci_ocid_from_state)"
  fi
  if [[ -z "${subnet_id}" ]]; then
    subnet_id="$(subnet_id_from_state)"
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "==> python3 missing — cannot API-clear Container Instance / VNIC" >&2
    return 1
  fi

  local args=(--timeout-seconds "${VNIC_CLEAR_TIMEOUT_SECONDS}")
  if [[ -n "${ci_ocid}" ]]; then
    args+=(--container-instance-id "${ci_ocid}")
  fi
  if [[ -n "${subnet_id}" ]]; then
    args+=(--subnet-id "${subnet_id}")
  fi

  echo "==> Clearing robot Container Instance / waiting for subnet VNIC release"
  OCI_API_PRIVATE_KEY_PATH="${key_path}" \
  OCI_TENANCY_OCID="${OCI_TENANCY_OCID:-${TF_VAR_tenancy_ocid:-}}" \
  OCI_USER_OCID="${OCI_USER_OCID:-${TF_VAR_user_ocid:-}}" \
  OCI_FINGERPRINT="${OCI_FINGERPRINT:-${TF_VAR_fingerprint:-}}" \
  OCI_REGION="${OCI_REGION:-${TF_VAR_region:-}}" \
  OCI_COMPARTMENT_OCID="${OCI_COMPARTMENT_OCID:-${TF_VAR_compartment_ocid:-}}" \
    python3 "${CLEAR_SCRIPT}" "${args[@]}"
}

# FAILED/tainted CIs often cannot be deleted via the OCI work request; API-delete
# first, then drop them from state so soft/hard destroy can finish the rest.
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
    local ocid subnet_id
    ocid="$(ci_ocid_from_state)"
    subnet_id="$(subnet_id_from_state)"
    echo "==> Unusable Container Instance in state — API-clearing before state rm"
    clear_robot_compute "${ocid}" "${subnet_id}" || true
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

# Recover local errored.tfstate after a backend PutObject failure so the next
# destroy attempt sees the partially-updated state.
push_errored_state_if_present() {
  if [[ -f "${TF_DIR}/errored.tfstate" ]]; then
    echo "==> Pushing errored.tfstate back to the remote backend"
    terraform state push "${TF_DIR}/errored.tfstate" || true
  fi
}

cd "${TF_DIR}"

# Bash 3.2 (macOS) + `set -u` treats empty `"${arr[@]}"` as unbound.
# Only expand an array when it has elements.
terraform_destroy() {
  terraform destroy -auto-approve -input=false "$@"
}

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

    destroy_args=("${target_flags[@]}")
    if [[ "${#TF_ARGS[@]}" -gt 0 ]]; then
      destroy_args+=("${TF_ARGS[@]}")
    fi

    set +e
    terraform_destroy "${destroy_args[@]}"
    code=$?
    set -e
    if [[ "${code}" -ne 0 ]]; then
      echo "==> Soft destroy failed — API-clearing Container Instance and retrying" >&2
      clear_robot_compute || true
      terraform state rm "${CI_ADDRESS}" >/dev/null 2>&1 || true
      push_errored_state_if_present
      target_flags=()
      while IFS= read -r flag; do
        [[ -n "${flag}" ]] || continue
        target_flags+=("${flag}")
      done < <(billable_target_flags || true)
      if [[ "${#target_flags[@]}" -eq 0 ]]; then
        echo "==> Soft destroy: remaining billable resources cleared"
        exit 0
      fi
      destroy_args=("${target_flags[@]}")
      if [[ "${#TF_ARGS[@]}" -gt 0 ]]; then
        destroy_args+=("${TF_ARGS[@]}")
      fi
      terraform_destroy "${destroy_args[@]}"
    fi
    echo "==> Soft destroy complete — billable resources removed; free stack left for reuse"
    ;;

  hard)
    echo "==> Hard destroy: removing every managed resource (IAM, budget, VCN, compute)"

    # Phase 1 — release the subnet VNIC before networking destroy.
    if terraform state list 2>/dev/null | grep -q "^${CI_ADDRESS}$"; then
      echo "==> Phase 1: terraform destroy Container Instance"
      set +e
      terraform_destroy -target="${CI_ADDRESS}"
      ci_code=$?
      set -e
      if [[ "${ci_code}" -ne 0 ]]; then
        echo "==> Targeted CI destroy failed — falling through to API clear" >&2
      fi
    else
      echo "==> Phase 1: Container Instance not in state (may already be self-deleted)"
    fi

    # Always API-clear + wait: covers self-deleted CI with a lingering VNIC,
    # FAILED CIs Terraform cannot delete, and orphans already dropped from state.
    clear_robot_compute || true
    terraform state rm "${CI_ADDRESS}" >/dev/null 2>&1 || true
    push_errored_state_if_present

    echo "==> Phase 2: terraform destroy remaining stack"
    set +e
    if [[ "${#TF_ARGS[@]}" -gt 0 ]]; then
      terraform_destroy "${TF_ARGS[@]}"
    else
      terraform_destroy
    fi
    code=$?
    set -e
    if [[ "${code}" -ne 0 ]]; then
      echo "==> Hard destroy failed — re-clearing compute / VNIC and retrying" >&2
      clear_robot_compute || true
      terraform state rm "${CI_ADDRESS}" >/dev/null 2>&1 || true
      push_errored_state_if_present
      if [[ "${#TF_ARGS[@]}" -gt 0 ]]; then
        terraform_destroy "${TF_ARGS[@]}"
      else
        terraform_destroy
      fi
    fi
    echo "==> Hard destroy complete — full stack removed"
    ;;

  *)
    echo "Unknown destroy mode: ${MODE} (expected soft|hard)" >&2
    exit 1
    ;;
esac
