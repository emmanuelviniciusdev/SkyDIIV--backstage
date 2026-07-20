#!/usr/bin/env bash
# Publishes a scrape-shopping-suggestions test event to the local Redis Stream.
#
# Usage:
#   ./scripts/publish-test-event.sh
#   MARKETPLACE=enjoei USER_ID=user-42 TERMS="vestido,jaqueta" ./scripts/publish-test-event.sh
#
# Requires redis-cli locally, or run via Docker:
#   docker compose exec redis redis-cli ...

set -euo pipefail

REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6380}"
STREAM_KEY="${REDIS_STREAM_KEY:-shopping-suggestions}"

MARKETPLACE="${MARKETPLACE:-enjoei}"
USER_ID="${USER_ID:-user-1}"
TERMS="${TERMS:-vestido floral}"

# Build JSON array from comma-separated terms
IFS=',' read -ra TERM_ARR <<< "${TERMS}"
json_terms="["
for i in "${!TERM_ARR[@]}"; do
  term="$(echo "${TERM_ARR[$i]}" | xargs)"
  [[ -z "${term}" ]] && continue
  [[ "${json_terms}" != "[" ]] && json_terms+=","
  json_terms+="\"${term}\""
done
json_terms+="]"

payload=$(cat <<EOF
{"marketplace":"${MARKETPLACE}","userid":"${USER_ID}","search_terms":${json_terms}}
EOF
)

run_redis() {
  if command -v redis-cli >/dev/null 2>&1; then
    redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" "$@"
  elif docker compose ps redis --status running >/dev/null 2>&1; then
    docker compose exec -T redis redis-cli "$@"
  else
    echo "redis-cli not found and redis compose service is not running" >&2
    exit 1
  fi
}

echo "Publishing to ${STREAM_KEY} @ ${REDIS_HOST}:${REDIS_PORT}"
echo "Payload: ${payload}"

run_redis XADD "${STREAM_KEY}" '*' event scrape-shopping-suggestions payload "${payload}"
echo "Done."
