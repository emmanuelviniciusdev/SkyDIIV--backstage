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

apt_busy() {
  local lock
  for lock in \
    /var/lib/dpkg/lock-frontend \
    /var/lib/dpkg/lock \
    /var/lib/apt/lists/lock \
    /var/cache/apt/archives/lock; do
    if command -v fuser >/dev/null 2>&1 && fuser "${lock}" >/dev/null 2>&1; then
      return 0
    fi
  done
  # Exact process names only (avoid -f self-match).
  if pgrep -x apt-get >/dev/null 2>&1 \
    || pgrep -x apt >/dev/null 2>&1 \
    || pgrep -x dpkg >/dev/null 2>&1 \
    || pgrep -x unattended-upgrade >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

wait_for_apt() {
  local timeout_s="${APT_WAIT_TIMEOUT_S:-600}"
  local deadline=$((SECONDS + timeout_s))

  while (( SECONDS < deadline )); do
    if ! apt_busy; then
      return 0
    fi
    log "Waiting for apt/dpkg lock (cloud-init/unattended-upgrades)…"
    sleep 10
  done

  echo "Timed out after ${timeout_s}s waiting for apt/dpkg lock" >&2
  exit 1
}

wait_for_cloud_init() {
  if ! command -v cloud-init >/dev/null 2>&1; then
    return 0
  fi
  # Don't block forever if cloud-init already finished or errored.
  local status
  status="$(cloud-init status 2>/dev/null | awk '{print $2}' | tr -d ',' || true)"
  if [[ "${status}" == "done" || "${status}" == "error" || "${status}" == "disabled" ]]; then
    return 0
  fi
  log "Waiting for cloud-init to finish…"
  cloud-init status --wait >/dev/null 2>&1 || true
}

apt_get() {
  wait_for_apt
  apt-get "$@"
}

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
  apt_get update -y
  apt_get install -y --no-install-recommends ca-certificates curl gnupg
  wait_for_apt
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt_get install -y --no-install-recommends nodejs
}

ensure_system_user() {
  if id skydiiv >/dev/null 2>&1; then
    return
  fi
  log "Creating system user skydiiv"
  useradd --system --create-home --home-dir /var/lib/skydiiv --shell /usr/sbin/nologin skydiiv
}

# better-sqlite3 (camoufox-js) needs a native build for this host (Ampere arm64).
ensure_native_build_deps() {
  if command -v g++ >/dev/null 2>&1 && command -v make >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    return
  fi
  log "Installing native module build tools (better-sqlite3)"
  apt_get update -y
  apt_get install -y --no-install-recommends build-essential python3
}

# Camoufox (Firefox) shared libs — same set as Dockerfile runtime stage.
ensure_camoufox_system_deps() {
  if ldconfig -p 2>/dev/null | grep -q 'libgtk-3\.so\.0'; then
    log "Camoufox system libraries already present (libgtk-3)"
    return
  fi

  log "Installing Camoufox / Firefox system libraries"
  apt_get update -y
  # Ubuntu 24.04 (noble) uses *t64 package names; older releases use the unversioned names.
  apt_get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2t64 \
    libatk-bridge2.0-0t64 \
    libatk1.0-0t64 \
    libcups2t64 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0t64 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxshmfence1 \
    xvfb \
    || apt_get install -y --no-install-recommends \
      ca-certificates \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxrandr2 \
      libxshmfence1 \
      xvfb
}

rebuild_native_modules() {
  log "Rebuilding native modules for $(uname -m) / Node $(node -v)"
  npm rebuild better-sqlite3
  # Fail fast if bindings still missing (common when ignore-scripts skipped compile).
  node -e "require('better-sqlite3'); console.log('better-sqlite3 bindings OK')"
}

main() {
  log "Deploying ${SERVICE_NAME} in ${APP_DIR}"
  cd "${APP_DIR}"

  wait_for_cloud_init
  ensure_node
  ensure_native_build_deps
  ensure_camoufox_system_deps
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
  # ignore-scripts: skip postinstall camoufox fetch here; we fetch explicitly below.
  # Native addons (better-sqlite3) are rebuilt for this VM arch afterward.
  if [[ -f package-lock.json ]]; then
    npm ci --omit=dev --ignore-scripts
  else
    npm install --omit=dev --ignore-scripts
  fi
  rebuild_native_modules

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
