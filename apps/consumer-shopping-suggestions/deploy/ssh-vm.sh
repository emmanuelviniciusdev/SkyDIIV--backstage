#!/usr/bin/env bash
# SSH into the consumer VM or stream systemd logs.
#
# Examples:
#   ./deploy/ssh-vm.sh
#   ./deploy/ssh-vm.sh --ssh-key ~/.ssh/skydiiv-oci-css
#   ./deploy/ssh-vm.sh logs
#   ./deploy/ssh-vm.sh logs --follow
#   ./deploy/ssh-vm.sh logs proxy
#   ./deploy/ssh-vm.sh status
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${ROOT_DIR}/deploy/terraform"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/skydiiv-oci-css}"
CONSUMER_SERVICE="consumer-shopping-suggestions"
PROXY_SERVICE="skydiiv-proxy-pool"
CMD="shell"
LOG_TARGET="consumer"
FOLLOW=0
LINES=100

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    shell) CMD="shell"; shift ;;
    logs) CMD="logs"; shift ;;
    status) CMD="status"; shift ;;
    consumer) LOG_TARGET="consumer"; shift ;;
    proxy) LOG_TARGET="proxy"; shift ;;
    --follow|-f) FOLLOW=1; shift ;;
    --lines|-n) LINES="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    *)
      echo "Unknown arg: $1" >&2
      usage 1
      ;;
  esac
done

if [[ ! -f "${SSH_KEY}" ]]; then
  echo "SSH private key not found: ${SSH_KEY}" >&2
  exit 1
fi
if [[ ! -d "${TF_DIR}" ]]; then
  echo "Missing terraform dir: ${TF_DIR}" >&2
  exit 1
fi

cd "${TF_DIR}"
if ! terraform output -raw instance_public_ip >/dev/null 2>&1; then
  echo "Terraform outputs unavailable. Run terraform apply in ${TF_DIR} first." >&2
  exit 1
fi

VM_HOST="$(terraform output -raw instance_public_ip)"
VM_USER="$(terraform output -raw ssh_user)"

# Ephemeral VMs often reuse a public IP with a new host key.
ssh-keygen -R "${VM_HOST}" >/dev/null 2>&1 || true

SSH_OPTS=(-i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new -t)

service_for_target() {
  case "${LOG_TARGET}" in
    consumer) echo "${CONSUMER_SERVICE}" ;;
    proxy) echo "${PROXY_SERVICE}" ;;
    *)
      echo "Unknown log target: ${LOG_TARGET}" >&2
      exit 1
      ;;
  esac
}

run_remote() {
  ssh "${SSH_OPTS[@]}" "${VM_USER}@${VM_HOST}" "$@"
}

case "${CMD}" in
  shell)
    echo "Connecting to ${VM_USER}@${VM_HOST}"
    echo "Useful on the VM:"
    echo "  sudo journalctl -u ${CONSUMER_SERVICE} -f"
    echo "  sudo journalctl -u ${PROXY_SERVICE} -f"
    echo "  sudo systemctl status ${CONSUMER_SERVICE} ${PROXY_SERVICE}"
    run_remote
    ;;
  logs)
    SERVICE="$(service_for_target)"
    REMOTE_CMD=(sudo journalctl -u "${SERVICE}" -n "${LINES}" --no-pager)
    if [[ "${FOLLOW}" -eq 1 ]]; then
      REMOTE_CMD=(sudo journalctl -u "${SERVICE}" -f)
    fi
    echo "==> ${SERVICE} logs on ${VM_USER}@${VM_HOST}"
    run_remote "${REMOTE_CMD[@]}"
    ;;
  status)
    echo "==> Service status on ${VM_USER}@${VM_HOST}"
    run_remote sudo systemctl --no-pager --full status "${CONSUMER_SERVICE}" "${PROXY_SERVICE}"
    ;;
esac
