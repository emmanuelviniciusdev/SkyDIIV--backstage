#!/usr/bin/env bash
# Merges application secrets env with infrastructure-generated PROXY_URLS.
# Infrastructure values win for PROXY_URLS / PROXY_BASE_PORT.
set -euo pipefail

APP_ENV_FILE="${APP_ENV_FILE:-/etc/skydiiv/consumer-shopping-suggestions.env}"
PROXY_ENV_FILE="${PROXY_ENV_FILE:-/etc/skydiiv/proxy-pool.env}"
OUTPUT_FILE="${OUTPUT_FILE:-${APP_ENV_FILE}}"

tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT

if [[ -f "${APP_ENV_FILE}" ]]; then
  # Drop any stale PROXY_* keys from the secrets file; infra owns them.
  grep -vE '^\s*(PROXY_URLS|PROXY_BASE_PORT)=' "${APP_ENV_FILE}" > "${tmp}" || true
else
  : > "${tmp}"
fi

if [[ -f "${PROXY_ENV_FILE}" ]]; then
  {
    echo ""
    echo "# --- infrastructure proxy pool (auto-generated) ---"
    cat "${PROXY_ENV_FILE}"
  } >> "${tmp}"
fi

install -m 600 "${tmp}" "${OUTPUT_FILE}"
echo "Merged env written to ${OUTPUT_FILE}"
