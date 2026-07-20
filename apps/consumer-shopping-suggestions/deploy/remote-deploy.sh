#!/usr/bin/env bash
# Fully automated remote deploy on the Oracle VM.
# Assumes the release tarball has already been extracted into APP_DIR.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/skydiiv/consumer-shopping-suggestions}"
SERVICE_NAME="${SERVICE_NAME:-consumer-shopping-suggestions}"
CAMOUFOX_INSTALL_DIR="${CAMOUFOX_INSTALL_DIR:-/opt/camoufox}"
APP_ENV_FILE="${APP_ENV_FILE:-/etc/skydiiv/consumer-shopping-suggestions.env}"
IPV6_POOL_FILE="${IPV6_POOL_FILE:-/var/lib/skydiiv/proxy-pool/ipv6-addresses.txt}"
PROXY_BASE_PORT="${PROXY_BASE_PORT:-11080}"
NODE_MAJOR="${NODE_MAJOR:-22}"

log() { echo "==> $*"; }

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [[ "${major}" -ge "${NODE_MAJOR}" ]]; then
      log "Node.js $(node -v) already installed"
      return
    fi
  fi

  log "Installing Node.js ${NODE_MAJOR}.x"
  apt-get update -y
  apt-get install -y --no-install-recommends ca-certificates curl gnupg
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y --no-install-recommends nodejs
}

ensure_system_user() {
  if id skydiiv >/dev/null 2>&1; then
    return
  fi
  log "Creating system user skydiiv"
  useradd --system --create-home --home-dir /var/lib/skydiiv --shell /usr/sbin/nologin skydiiv
}

main() {
  log "Deploying ${SERVICE_NAME} in ${APP_DIR}"
  cd "${APP_DIR}"

  ensure_node
  ensure_system_user
  mkdir -p /etc/skydiiv /var/lib/skydiiv/proxy-pool "${CAMOUFOX_INSTALL_DIR}"

  # 1) Provision / refresh the IPv6 → SOCKS proxy pool (infra layer)
  if [[ -f deploy/setup-proxy-pool.sh ]]; then
    log "Setting up proxy pool"
    PROXY_BASE_PORT="${PROXY_BASE_PORT}" \
      IPV6_POOL_FILE="${IPV6_POOL_FILE}" \
      bash deploy/setup-proxy-pool.sh
  fi

  # 2) Merge secrets + infrastructure PROXY_URLS into the consumer env
  if [[ -f deploy/merge-env.sh ]]; then
    log "Merging application env with proxy pool"
    APP_ENV_FILE="${APP_ENV_FILE}" bash deploy/merge-env.sh
  fi

  # 3) Install production dependencies + Camoufox browser binary
  if [[ -f package-lock.json ]]; then
    npm ci --omit=dev --ignore-scripts
  else
    npm install --omit=dev --ignore-scripts
  fi

  CAMOUFOX_INSTALL_DIR="${CAMOUFOX_INSTALL_DIR}" npx camoufox-js fetch

  chown -R skydiiv:skydiiv "${APP_DIR}" "${CAMOUFOX_INSTALL_DIR}" /var/lib/skydiiv

  # 4) Install / restart systemd unit
  if [[ -f deploy/consumer-shopping-suggestions.service ]]; then
    cp deploy/consumer-shopping-suggestions.service "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    systemctl enable "${SERVICE_NAME}"
  fi

  systemctl restart "${SERVICE_NAME}"
  sleep 2
  systemctl --no-pager --full status "${SERVICE_NAME}" || true

  log "Deploy complete"
}

main "$@"
