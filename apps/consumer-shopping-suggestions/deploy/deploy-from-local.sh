#!/usr/bin/env bash
# Deploy consumer-shopping-suggestions from localhost to the OCI VM.
#
# PAYG: STOPPED VMs still bill for boot volumes — prefer destroy over stop.
# The Thursday live window is owned by GitHub Actions (create → destroy).
#
# Modes:
#   --test         START VM, deploy, leave RUNNING (storage bills until you destroy).
#   --production   START VM, deploy, then terraform destroy (no idle storage).
#
# Required tools: terraform, ssh, scp, python3 (+ pip), npm
# The OCI Python SDK (`oci`) is installed automatically if missing.
#
# Example (test — remember to destroy when done):
#   ./deploy/deploy-from-local.sh --test \
#     --ssh-key ~/.ssh/skydiiv-oci-css
#   ./deploy/destroy-from-local.sh --yes
#
# Example (ephemeral smoke):
#   ./deploy/deploy-from-local.sh --production \
#     --ssh-key ~/.ssh/skydiiv-oci-css --yes
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
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

ensure_oci_sdk() {
  if python3 -c "import oci" >/dev/null 2>&1; then
    return 0
  fi
  log "Installing Python package oci (required for instance start/stop)"
  if ! python3 -m pip install --user oci; then
    echo "Failed to install oci. Try: python3 -m pip install --user oci" >&2
    exit 1
  fi
  if ! python3 -c "import oci" >/dev/null 2>&1; then
    echo "oci installed but not importable by $(command -v python3)." >&2
    echo "Try: python3 -m pip install --user oci" >&2
    exit 1
  fi
}

# Read a simple string assignment from terraform.tfvars (macOS-safe; no \s).
tfvars_str() {
  local key="$1"
  local file="${2:-terraform.tfvars}"
  grep -E "^[[:space:]]*${key}[[:space:]]*=" "${file}" \
    | head -1 \
    | sed -E 's/^[^=]*=[[:space:]]*"?([^"#]+)"?.*/\1/' \
    | sed -E 's/[[:space:]]+$//'
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

ensure_oci_sdk

cd "${TF_DIR}"

log "Terraform apply (mode=${MODE})"
APPLY_FLAGS=(-input=false)
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
OCI_REGION="$(tfvars_str region)"
export OCI_API_PRIVATE_KEY_PATH
OCI_API_PRIVATE_KEY_PATH="$(tfvars_str private_key_path)"
export OCI_TENANCY_OCID
OCI_TENANCY_OCID="$(tfvars_str tenancy_ocid)"
export OCI_USER_OCID
OCI_USER_OCID="$(tfvars_str user_ocid)"
export OCI_FINGERPRINT
OCI_FINGERPRINT="$(tfvars_str fingerprint)"

if [[ -z "${OCI_REGION}" || -z "${OCI_API_PRIVATE_KEY_PATH}" || -z "${OCI_TENANCY_OCID}" || -z "${OCI_USER_OCID}" || -z "${OCI_FINGERPRINT}" ]]; then
  echo "Failed to read OCI credentials from ${TF_DIR}/terraform.tfvars" >&2
  echo "Need: region, private_key_path, tenancy_ocid, user_ocid, fingerprint" >&2
  exit 1
fi
if [[ ! -f "${OCI_API_PRIVATE_KEY_PATH}" ]]; then
  echo "OCI API private key not found: ${OCI_API_PRIVATE_KEY_PATH}" >&2
  echo "Check private_key_path in terraform.tfvars" >&2
  exit 1
fi

terraform output -raw ipv6_pool_file > /tmp/ipv6-addresses.txt

log "Ensuring VM is RUNNING (schedule does not gate test starts)"
python3 "${ROOT_DIR}/deploy/oci_instance_action.py" START --instance-id "${OCI_INSTANCE_OCID}" --region "${OCI_REGION}" --wait

# Ephemeral VMs often reuse a public IP with a new host key — drop the stale entry.
ssh-keygen -R "${VM_HOST}" >/dev/null 2>&1 || true

log "Waiting for SSH on ${VM_USER}@${VM_HOST} (up to ~5 min on first boot)"
SSH_OK=0
SSH_OPTS=(-i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 -o BatchMode=yes)
for i in $(seq 1 60); do
  if ssh "${SSH_OPTS[@]}" "${VM_USER}@${VM_HOST}" 'echo ok' >/dev/null 2>&1; then
    SSH_OK=1
    break
  fi
  if (( i % 6 == 0 )); then
    log "Still waiting for SSH… (${i}/60 attempts, ~$((i * 5))s)"
  fi
  sleep 5
done
if [[ "${SSH_OK}" -ne 1 ]]; then
  echo "SSH not reachable at ${VM_USER}@${VM_HOST} after ~5 minutes." >&2
  echo "If you see REMOTE HOST IDENTIFICATION HAS CHANGED, run: ssh-keygen -R ${VM_HOST}" >&2
  echo "Then: ssh -i ${SSH_KEY} ${VM_USER}@${VM_HOST}" >&2
  exit 1
fi
ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new "${VM_USER}@${VM_HOST}" 'echo SSH ready'

cd "${ROOT_DIR}"
if [[ "${SKIP_BUILD}" -eq 0 ]]; then
  log "Build release"
  npm ci --ignore-scripts
  npm run build
fi
chmod +x deploy/*.sh
# Avoid macOS xattr noise (LIBARCHIVE.xattr…) when Linux extracts the tarball.
export COPYFILE_DISABLE=1
tar --no-xattrs -czf /tmp/consumer-shopping-suggestions.tgz \
  package.json package-lock.json dist deploy .env.example 2>/dev/null \
  || tar -czf /tmp/consumer-shopping-suggestions.tgz \
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
  log "Production mode: terraform destroy (remove VM + boot volume — no idle PAYG storage)"
  cd "${TF_DIR}"
  DESTROY_FLAGS=(-input=false)
  if [[ "${AUTO_APPROVE}" -eq 1 ]]; then
    DESTROY_FLAGS+=(-auto-approve)
  fi
  terraform destroy "${DESTROY_FLAGS[@]}"
  log "Done. Thursday live window: GitHub Actions Weekly workflow (create 10:00 / destroy 12:05 BRT)."
else
  log "Test mode: VM left RUNNING — boot volume bills on PAYG until destroyed."
  log "When finished: ./deploy/destroy-from-local.sh --yes"
fi
