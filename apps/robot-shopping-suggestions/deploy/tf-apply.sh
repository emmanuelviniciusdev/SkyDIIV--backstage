#!/usr/bin/env bash
# `terraform apply` for the robot stack, tolerating a Container Instance that
# already finished its job.
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
# This only covers states that prove the container already ran. Image-pull,
# authorization and networking problems surface as "Work Request error" instead
# and still fail the apply.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${TF_DIR:-${ROOT}/deploy/terraform}"
CI_ADDRESS="oci_container_instances_container_instance.robot"

# States only reachable after the container has been pulled, started and exited.
FINISHED_STATE_PATTERN='expected the resource to reach state\(s\): ACTIVE, but the service reported unexpected state: (DELETED|DELETING|INACTIVE|UPDATING)'

cd "${TF_DIR}"

log="$(mktemp)"
trap 'rm -f "${log}"' EXIT

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

exit "${code}"
