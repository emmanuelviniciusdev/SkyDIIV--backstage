#!/usr/bin/env bash
# Discovers (or reads) IPv6 addresses on the VM, installs microsocks if needed,
# binds one SOCKS listener per address, and writes PROXY_URLS for the consumer.
#
# Invoked automatically by remote-deploy.sh — no manual steps required.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/skydiiv/consumer-shopping-suggestions}"
STATE_DIR="${STATE_DIR:-/var/lib/skydiiv/proxy-pool}"
ENV_DIR="${ENV_DIR:-/etc/skydiiv}"
PROXY_BASE_PORT="${PROXY_BASE_PORT:-11080}"
IPV6_POOL_FILE="${IPV6_POOL_FILE:-${STATE_DIR}/ipv6-addresses.txt}"
PROXY_ENV_FILE="${PROXY_ENV_FILE:-${ENV_DIR}/proxy-pool.env}"
SERVICE_NAME="${PROXY_POOL_SERVICE_NAME:-skydiiv-proxy-pool}"

mkdir -p "${STATE_DIR}" "${ENV_DIR}"

log() { echo "==> $*" >&2; }

wait_for_apt() {
  local timeout_s="${APT_WAIT_TIMEOUT_S:-600}"
  local deadline=$((SECONDS + timeout_s))
  while (( SECONDS < deadline )); do
    local busy=0
    if command -v fuser >/dev/null 2>&1; then
      if fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 \
        || fuser /var/lib/dpkg/lock >/dev/null 2>&1; then
        busy=1
      fi
    fi
    if pgrep -x apt-get >/dev/null 2>&1 \
      || pgrep -x apt >/dev/null 2>&1 \
      || pgrep -x dpkg >/dev/null 2>&1 \
      || pgrep -x unattended-upgrade >/dev/null 2>&1; then
      busy=1
    fi
    if [[ "${busy}" -eq 0 ]]; then
      return 0
    fi
    log "Waiting for apt/dpkg lock…"
    sleep 10
  done
  echo "Timed out after ${timeout_s}s waiting for apt/dpkg lock" >&2
  exit 1
}

install_microsocks() {
  if command -v microsocks >/dev/null 2>&1; then
    log "microsocks already installed: $(command -v microsocks)"
    return
  fi

  log "Installing microsocks from source"
  wait_for_apt
  apt-get update -y
  wait_for_apt
  apt-get install -y --no-install-recommends build-essential git ca-certificates

  local tmp
  tmp="$(mktemp -d)"
  git clone --depth 1 https://github.com/rofl0r/microsocks.git "${tmp}/microsocks"
  make -C "${tmp}/microsocks"
  install -m 0755 "${tmp}/microsocks/microsocks" /usr/local/bin/microsocks
  rm -rf "${tmp}"
}

primary_iface() {
  ip -6 route show default | awk '{print $5; exit}' \
    || ip -o link show | awk -F': ' '$2 != "lo" {print $2; exit}'
}

# Ensure Terraform-assigned IPv6s exist on the guest NIC (OCI VNIC alone is not enough).
ensure_ipv6_on_interface() {
  local iface
  iface="$(primary_iface)"
  if [[ -z "${iface}" ]]; then
    log "WARNING: could not detect primary interface"
    return
  fi

  local addr
  while IFS= read -r addr; do
    [[ -z "${addr}" ]] && continue
    if ip -6 addr show dev "${iface}" | grep -qF "${addr}"; then
      continue
    fi
    log "Adding ${addr}/128 to ${iface}"
    ip -6 addr add "${addr}/128" dev "${iface}" || true
  done < <(grep -vE '^\s*(#|$)' "${IPV6_POOL_FILE}" | sed 's/%.*//;s/[[:space:]]//g' | grep -E ':' || true)
}

discover_ipv6_addresses() {
  if [[ -f "${IPV6_POOL_FILE}" ]] && [[ -s "${IPV6_POOL_FILE}" ]]; then
    log "Using IPv6 pool from ${IPV6_POOL_FILE}"
    ensure_ipv6_on_interface
    grep -vE '^\s*(#|$)' "${IPV6_POOL_FILE}" | sed 's/%.*//;s/[[:space:]]//g' | grep -E ':' || true
    return
  fi

  log "No pool file found — discovering non-link-local global IPv6 addresses"
  # Exclude link-local (fe80::) and loopback (::1)
  ip -6 -o addr show scope global \
    | awk '{print $4}' \
    | cut -d/ -f1 \
    | grep -vE '^fe80:' \
    | sort -u || true
}

write_proxy_pool_runner() {
  local runner="${STATE_DIR}/run-proxy-pool.sh"
  cat > "${runner}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${STATE_DIR:-/var/lib/skydiiv/proxy-pool}"
IPV6_POOL_FILE="${IPV6_POOL_FILE:-${STATE_DIR}/ipv6-addresses.txt}"
PROXY_BASE_PORT="${PROXY_BASE_PORT:-11080}"
MICROSOCKS_BIN="${MICROSOCKS_BIN:-/usr/local/bin/microsocks}"

if [[ ! -x "${MICROSOCKS_BIN}" ]]; then
  MICROSOCKS_BIN="$(command -v microsocks)"
fi

mapfile -t ADDRS < <(grep -vE '^\s*(#|$)' "${IPV6_POOL_FILE}" | sed 's/%.*//' | tr -d ' ' | grep -E ':' || true)
if [[ ${#ADDRS[@]} -eq 0 ]]; then
  echo "No IPv6 addresses in ${IPV6_POOL_FILE}" >&2
  exit 1
fi

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do
    kill "${pid}" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

index=0
for addr in "${ADDRS[@]}"; do
  port=$((PROXY_BASE_PORT + index))
  echo "Starting microsocks on 127.0.0.1:${port} via ${addr}"
  # -i = listen address (browser connects here); -b = outbound bind (IPv6 egress).
  "${MICROSOCKS_BIN}" -p "${port}" -i 127.0.0.1 -b "${addr}" &
  pids+=($!)
  index=$((index + 1))
done

echo "Proxy pool ready (${#ADDRS[@]} listeners)"
wait
EOF
  chmod +x "${runner}"
}

write_systemd_unit() {
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=SkyDIIV IPv6 SOCKS proxy pool
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=STATE_DIR=${STATE_DIR}
Environment=IPV6_POOL_FILE=${IPV6_POOL_FILE}
Environment=PROXY_BASE_PORT=${PROXY_BASE_PORT}
ExecStart=${STATE_DIR}/run-proxy-pool.sh
Restart=always
RestartSec=3
KillMode=control-group

[Install]
WantedBy=multi-user.target
EOF
}

write_proxy_urls_env() {
  local count="$1"
  shift
  local addresses=("$@")
  local urls=()
  local i
  for ((i = 0; i < count; i++)); do
    urls+=("socks5://127.0.0.1:$((PROXY_BASE_PORT + i))")
  done

  local joined
  joined="$(IFS=,; echo "${urls[*]}")"
  local egress_joined
  egress_joined="$(IFS=,; echo "${addresses[*]}")"

  cat > "${PROXY_ENV_FILE}" <<EOF
# Generated by setup-proxy-pool.sh — do not edit by hand.
PROXY_URLS=${joined}
PROXY_EGRESS_IPS=${egress_joined}
PROXY_BASE_PORT=${PROXY_BASE_PORT}
EOF
  chmod 644 "${PROXY_ENV_FILE}"
  log "Wrote ${PROXY_ENV_FILE}"
  log "PROXY_URLS=${joined}"
  log "PROXY_EGRESS_IPS=${egress_joined}"
}

main() {
  install_microsocks

  mapfile -t ADDRESSES < <(discover_ipv6_addresses)
  if [[ ${#ADDRESSES[@]} -eq 0 ]]; then
    echo "ERROR: no global IPv6 addresses available for the proxy pool." >&2
    echo "Ensure Terraform assigned IPv6s and the subnet has IPv6 enabled." >&2
    exit 1
  fi

  printf '%s\n' "${ADDRESSES[@]}" > "${IPV6_POOL_FILE}"
  chmod 644 "${IPV6_POOL_FILE}"
  log "Persisted ${#ADDRESSES[@]} IPv6 address(es) to ${IPV6_POOL_FILE}"

  write_proxy_pool_runner
  write_systemd_unit
  write_proxy_urls_env "${#ADDRESSES[@]}" "${ADDRESSES[@]}"

  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  systemctl restart "${SERVICE_NAME}"
  systemctl --no-pager --full status "${SERVICE_NAME}" || true

  log "Proxy pool service ${SERVICE_NAME} is up"
}

main "$@"
