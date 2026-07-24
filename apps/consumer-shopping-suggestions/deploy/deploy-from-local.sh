#!/usr/bin/env bash
# Deploy consumer-shopping-suggestions from localhost to the OCI VM.
#
# Modes:
#   --test         Disable weekly schedule (via terraform), START VM now, deploy, leave RUNNING.
#                  The Thursday start/stop window does NOT apply.
#   --production   Keep weekly schedule enabled (terraform), START VM for the deploy,
#                  then STOP again so compute only runs inside the scheduled window
#                  (unless you are already inside Thursday 11:00–12:00 BRT).
#
# Required tools: terraform, ssh, scp, python3 + `pip install oci`, npm
#
# Example (test):
#   ./deploy/deploy-from-local.sh --test \
#     --ssh-key ~/.ssh/skydiiv-oci-css
#
# Example (production-like):
#   ./deploy/deploy-from-local.sh --production \
#     --ssh-key ~/.ssh/skydiiv-oci-css
#
# App secrets default to ${ROOT_DIR}/.env (see docs/ENV.md).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${ROOT_DIR}/deploy/terraform"
MODE=""
ENV_FILE=""
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/skydiiv-oci-css}"
SKIP_BUILD=0
AUTO_APPROVE=0

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --test) MODE="test"; shift ;;
    --production) MODE="production"; shift ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --yes) AUTO_APPROVE=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown arg: $1" >&2; usage 1 ;;
  esac
done

if [[ -z "${MODE}" ]]; then
  echo "Choose --test or --production" >&2
  usage 1
fi
if [[ -z "${ENV_FILE}" ]]; then
  ENV_FILE="${ROOT_DIR}/.env"
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  echo "Copy .env.example → .env in the project root (see docs/ENV.md)." >&2
  exit 1
fi
if [[ ! -f "${SSH_KEY}" ]]; then
  echo "SSH private key not found: ${SSH_KEY}" >&2
  exit 1
fi
if [[ ! -f "${TF_DIR}/terraform.tfvars" ]]; then
  echo "Missing ${TF_DIR}/terraform.tfvars — copy from terraform.tfvars.example first." >&2
  exit 1
fi

log() { echo "==> $*"; }

ENABLE_SCHEDULE="true"
if [[ "${MODE}" == "test" ]]; then
  ENABLE_SCHEDULE="false"
fi

cd "${TF_DIR}"

log "Terraform apply (enable_weekly_schedule=${ENABLE_SCHEDULE}, mode=${MODE})"
APPLY_FLAGS=(-var="enable_weekly_schedule=${ENABLE_SCHEDULE}" -input=false)
if [[ "${AUTO_APPROVE}" -eq 1 ]]; then
  APPLY_FLAGS+=(-auto-approve)
fi
terraform apply "${APPLY_FLAGS[@]}"

export OCI_INSTANCE_OCID
OCI_INSTANCE_OCID="$(terraform output -raw instance_ocid)"
export VM_HOST
VM_HOST="$(terraform output -raw instance_public_ip)"
export VM_USER
VM_USER="$(terraform output -raw ssh_user)"
export OCI_REGION
OCI_REGION="$(grep -E '^\s*region\s*=' terraform.tfvars | sed -E 's/.*=\s*"?([^"]+)"?.*/\1/' | head -1)"
export OCI_API_PRIVATE_KEY_PATH
OCI_API_PRIVATE_KEY_PATH="$(grep -E '^\s*private_key_path\s*=' terraform.tfvars | sed -E 's/.*=\s*"?([^"]+)"?.*/\1/' | head -1)"
export OCI_TENANCY_OCID
OCI_TENANCY_OCID="$(grep -E '^\s*tenancy_ocid\s*=' terraform.tfvars | sed -E 's/.*=\s*"?([^"]+)"?.*/\1/' | head -1)"
export OCI_USER_OCID
OCI_USER_OCID="$(grep -E '^\s*user_ocid\s*=' terraform.tfvars | sed -E 's/.*=\s*"?([^"]+)"?.*/\1/' | head -1)"
export OCI_FINGERPRINT
OCI_FINGERPRINT="$(grep -E '^\s*fingerprint\s*=' terraform.tfvars | sed -E 's/.*=\s*"?([^"]+)"?.*/\1/' | head -1)"

terraform output -raw ipv6_pool_file > /tmp/ipv6-addresses.txt

log "Ensuring VM is RUNNING (schedule does not gate test starts)"
python3 "${ROOT_DIR}/deploy/oci_instance_action.py" START --instance-id "${OCI_INSTANCE_OCID}" --region "${OCI_REGION}" --wait

log "Waiting for SSH on ${VM_USER}@${VM_HOST}"
for _ in $(seq 1 60); do
  if ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 \
    "${VM_USER}@${VM_HOST}" 'echo ok' >/dev/null 2>&1; then
    break
  fi
  sleep 5
done
ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new "${VM_USER}@${VM_HOST}" 'echo SSH ready'

cd "${ROOT_DIR}"
if [[ "${SKIP_BUILD}" -eq 0 ]]; then
  log "Build release"
  npm ci --ignore-scripts
  npm run build
fi
chmod +x deploy/*.sh
tar -czf /tmp/consumer-shopping-suggestions.tgz \
  package.json package-lock.json dist deploy .env.example

log "Upload artifacts"
scp -i "${SSH_KEY}" \
  /tmp/consumer-shopping-suggestions.tgz \
  /tmp/ipv6-addresses.txt \
  "${ENV_FILE}" \
  "${VM_USER}@${VM_HOST}:/tmp/"

REMOTE_ENV_NAME="$(basename "${ENV_FILE}")"
ssh -i "${SSH_KEY}" "${VM_USER}@${VM_HOST}" "bash -s" <<EOF
set -euo pipefail
sudo mkdir -p /etc/skydiiv /var/lib/skydiiv/proxy-pool /opt/skydiiv/consumer-shopping-suggestions
sudo install -m 600 "/tmp/${REMOTE_ENV_NAME}" /etc/skydiiv/consumer-shopping-suggestions.env
sudo install -m 644 /tmp/ipv6-addresses.txt /var/lib/skydiiv/proxy-pool/ipv6-addresses.txt
sudo tar -xzf /tmp/consumer-shopping-suggestions.tgz -C /opt/skydiiv/consumer-shopping-suggestions
cd /opt/skydiiv/consumer-shopping-suggestions
sudo PROXY_BASE_PORT=11080 \
  IPV6_POOL_FILE=/var/lib/skydiiv/proxy-pool/ipv6-addresses.txt \
  bash deploy/remote-deploy.sh
EOF

if [[ "${MODE}" == "production" ]]; then
  log "Production mode: stopping VM so weekly schedule owns uptime"
  python3 "${ROOT_DIR}/deploy/oci_instance_action.py" STOP --instance-id "${OCI_INSTANCE_OCID}" --region "${OCI_REGION}" --wait
  log "Done. Schedules: START Thu 11:00 / STOP Thu 12:00 (America/Sao_Paulo)."
else
  log "Test mode: weekly schedule DISABLED; VM left RUNNING."
  log "Re-enable production schedule later with:"
  log "  cd deploy/terraform && terraform apply -var='enable_weekly_schedule=true'"
fi
