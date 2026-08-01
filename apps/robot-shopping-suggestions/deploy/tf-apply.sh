#!/usr/bin/env bash
# `terraform apply` for the robot stack, tolerating a Container Instance that
# already finished its job, and retrying OCIR pull races after fresh IAM create.
#
# The robot drains the queue and then deletes its own Container Instance. When
# the queue is short that can happen before Terraform's create-wait polls again,
# so Terraform reports
#
#   expected the resource to reach state(s): ACTIVE,
#   but the service reported unexpected state: DELETED
#
# even though the run did exactly what it was supposed to. That is a successful
# weekly run, not a deployment failure.
#
# OCIR pull failures after a fresh dynamic-group + policy create are a different
# case. OCI IAM is eventually consistent; an early pull is denied and reported
# as the misleading "inadequate network configuration" work-request error (the
# pull is not retried by the service). This wrapper drops the failed Container
# Instance from state, waits for IAM to propagate, and re-applies so only the
# CI is recreated — VCN/IAM stay. Weekly soft destroy keeps free resources;
# hard destroy still tears everything down.
#
# Env (optional):
#   OCIR_PULL_MAX_ATTEMPTS        total apply attempts (default 3)
#   OCIR_PULL_RETRY_WAIT_SECONDS  sleep between pull-error retries (default 90)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${TF_DIR:-${ROOT}/deploy/terraform}"
CI_ADDRESS="oci_container_instances_container_instance.robot"

# States only reachable after the container has been pulled, started and exited.
FINISHED_STATE_PATTERN='expected the resource to reach state\(s\): ACTIVE, but the service reported unexpected state: (DELETED|DELETING|INACTIVE|UPDATING)'

# OCI collapses OCIR authorization races into this message (see iam.tf / README).
PULL_ERROR_PATTERN='image could not be pulled|inadequate network configuration'

MAX_ATTEMPTS="${OCIR_PULL_MAX_ATTEMPTS:-3}"
RETRY_WAIT_SECONDS="${OCIR_PULL_RETRY_WAIT_SECONDS:-90}"

cd "${TF_DIR}"

# Read the CI OCID from state (empty when absent).
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

# Best-effort API delete so a FAILED orphan does not keep counting against limits.
# Uses the same TF_VAR_* / key path the apply already has; no-ops without oci SDK.
force_delete_ci() {
  local ocid="${1:-}"
  case "${ocid}" in
    ocid1.*) ;;
    *) return 0 ;;
  esac

  local key_path="${OCI_API_PRIVATE_KEY_PATH:-${TF_VAR_private_key_path:-}}"
  if [[ -n "${key_path}" && ! "${key_path}" = /* ]]; then
    key_path="${TF_DIR}/${key_path}"
  fi

  echo "==> Best-effort OCI delete of failed Container Instance ${ocid}"
  OCI_API_PRIVATE_KEY_PATH="${key_path}" \
  OCI_TENANCY_OCID="${OCI_TENANCY_OCID:-${TF_VAR_tenancy_ocid:-}}" \
  OCI_USER_OCID="${OCI_USER_OCID:-${TF_VAR_user_ocid:-}}" \
  OCI_FINGERPRINT="${OCI_FINGERPRINT:-${TF_VAR_fingerprint:-}}" \
  OCI_REGION="${OCI_REGION:-${TF_VAR_region:-}}" \
  python3 - "${ocid}" <<'PY' || true
import os, sys

ocid = sys.argv[1]
try:
    import oci  # type: ignore
except ImportError:
    print("oci SDK not installed — orphaned CI left for later destroy/manual cleanup", file=sys.stderr)
    raise SystemExit(0)

key_path = os.environ.get("OCI_API_PRIVATE_KEY_PATH", "").strip()
tenancy = os.environ.get("OCI_TENANCY_OCID", "").strip()
user = os.environ.get("OCI_USER_OCID", "").strip()
fingerprint = os.environ.get("OCI_FINGERPRINT", "").strip()
region = os.environ.get("OCI_REGION", "").strip() or "us-ashburn-1"

if not (key_path and tenancy and user and fingerprint and os.path.isfile(key_path)):
    print("OCI credentials incomplete — skipping API delete", file=sys.stderr)
    raise SystemExit(0)

config = {
    "user": user,
    "key_file": key_path,
    "fingerprint": fingerprint,
    "tenancy": tenancy,
    "region": region,
}
client = oci.container_instances.ContainerInstanceClient(config)
try:
    state = client.get_container_instance(ocid).data.lifecycle_state
except Exception as err:  # noqa: BLE001
    print(f"Could not read Container Instance ({err}) — assuming already gone")
    raise SystemExit(0)

print(f"Container Instance lifecycle_state={state}")
if state in ("DELETED", "DELETING"):
    raise SystemExit(0)
try:
    client.delete_container_instance(ocid)
    print(f"Delete requested for {ocid}")
except Exception as err:  # noqa: BLE001
    print(f"Delete request failed ({err}) — continuing retry")
PY
}

# FAILED/tainted CIs often cannot be destroyed via the OCI work request; dropping
# them from state lets the next apply create a replacement (see deploy-from-local).
drop_failed_container_instance() {
  terraform state list 2>/dev/null | grep -q "^${CI_ADDRESS}$" || return 0

  local ocid
  ocid="$(ci_ocid_from_state)"

  echo "==> Dropping failed Container Instance from Terraform state"
  terraform state rm "${CI_ADDRESS}" >/dev/null 2>&1 || true

  if [[ -n "${ocid}" ]]; then
    force_delete_ci "${ocid}"
  fi
}

log="$(mktemp)"
trap 'rm -f "${log}"' EXIT

attempt=1
while true; do
  : >"${log}"

  echo "==> terraform apply (attempt ${attempt}/${MAX_ATTEMPTS})"
  set +e
  terraform apply -auto-approve -input=false "$@" 2>&1 | tee "${log}"
  code=${PIPESTATUS[0]}
  set -e

  if [[ "${code}" -eq 0 ]]; then
    exit 0
  fi

  if grep -qE "${FINISHED_STATE_PATTERN}" "${log}"; then
    echo
    echo "==> Container Instance finished its drain and self-deleted before terraform observed ACTIVE."
    echo "    That is the intended end state for the CRON robot — treating apply as successful."
    # Terraform recorded a resource that no longer exists; leaving it in state
    # makes the next apply/destroy fail on it.
    terraform state rm "${CI_ADDRESS}" >/dev/null 2>&1 || true
    exit 0
  fi

  if grep -qiE "${PULL_ERROR_PATTERN}" "${log}" && [[ "${attempt}" -lt "${MAX_ATTEMPTS}" ]]; then
    echo
    echo "==> OCIR image pull failed (attempt ${attempt}/${MAX_ATTEMPTS})."
    echo "    Often IAM eventual consistency after a fresh dynamic-group/policy create."
    echo "    OCI does not retry the pull — recreating the Container Instance after a wait."
    drop_failed_container_instance
    echo "==> Waiting ${RETRY_WAIT_SECONDS}s for OCIR pull authorization to propagate"
    sleep "${RETRY_WAIT_SECONDS}"
    attempt=$((attempt + 1))
    continue
  fi

  exit "${code}"
done
