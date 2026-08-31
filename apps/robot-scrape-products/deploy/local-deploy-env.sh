#!/usr/bin/env bash
# Shared loader for local terraform apply/destroy.
# - deploy/local.env     → TF_VAR_container_image_url (and optional overrides)
# - deploy/terraform/terraform.tfvars → OCI ids for cost gate
# - .env                 → app secrets → TF_VAR_robot_env (JSON)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${ROOT}/deploy/terraform"

# shellcheck disable=SC1091
source "${ROOT}/deploy/oci-s3-backend-env.sh"

if [[ -f "${ROOT}/deploy/local.env" ]]; then
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    if [[ "${line}" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      if [[ "${val}" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
      if [[ "${val}" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
      export "${key}=${val}"
    fi
  done < "${ROOT}/deploy/local.env"
fi

if [[ -f "${TF_DIR}/terraform.tfvars" ]]; then
  while IFS= read -r line; do
    [[ -n "${line}" ]] && eval "${line}"
  done < <(python3 "${ROOT}/deploy/export-tfvars-oci-env.py" "${TF_DIR}/terraform.tfvars")
fi

export OCI_API_PRIVATE_KEY_PATH="${OCI_API_PRIVATE_KEY_PATH:-${TF_DIR}/oci_api_key.pem}"

if [[ -z "${TF_VAR_robot_env:-}" ]]; then
  if [[ -f "${ROOT}/.env" ]]; then
    export TF_VAR_robot_env="$(python3 "${ROOT}/deploy/build-robot-env.py")"
  else
    export TF_VAR_robot_env="{}"
  fi
fi
