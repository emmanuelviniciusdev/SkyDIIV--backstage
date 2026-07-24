#!/usr/bin/env bash
# Publish an event to Cloudflare Queues (HTTP push) — default broker for local + production.
#
# Loads credentials from ./.env by default (project root).
# See docs/ENV.md and docs/PUBLISH_EVENTS.md.
#
# Usage:
#   ./scripts/publish-event.sh
#   MARKETPLACE=enjoei USER_ID=user-42 TERMS="vestido,jaqueta" ./scripts/publish-event.sh
#   EVENT=scrape-shopping-suggestions ./scripts/publish-event.sh
#   ./scripts/publish-event.sh --env-file .env
#   ./scripts/publish-event.sh --dry-run
#
# Requires: curl, and python3 or jq.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

ENV_FILE=""
DRY_RUN=0
EVENT="${EVENT:-scrape-shopping-suggestions}"
MARKETPLACE="${MARKETPLACE:-enjoei}"
USER_ID="${USER_ID:-user-1}"
TERMS="${TERMS:-vestido floral}"

usage() {
  cat <<'EOF'
Publish an event to Cloudflare Queues (default broker).

Options:
  --env-file <path>   Dotenv with CF_* (default: ./.env in the project root)
  --dry-run           Print the request body without calling the API
  -h, --help          Show this help

Env:
  EVENT         Event name (default: scrape-shopping-suggestions)
  MARKETPLACE   For scrape event (default: enjoei)
  USER_ID       For scrape event (default: user-1)
  TERMS         Comma-separated search terms for scrape event
  CF_ACCOUNT_ID / CF_QUEUE_ID / CF_QUEUES_API_TOKEN

See docs/ENV.md — all local secrets stay in this project directory.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

load_env_file() {
  local file="$1"
  if [[ ! -f "${file}" ]]; then
    echo "Env file not found: ${file}" >&2
    exit 1
  fi
  local preexisting=()
  local key
  for key in CF_ACCOUNT_ID CF_QUEUE_ID CF_QUEUES_API_TOKEN; do
    if [[ -n "${!key-}" ]]; then
      preexisting+=("${key}=${!key}")
    fi
  done
  set -a
  # shellcheck disable=SC1090
  source "${file}"
  set +a
  local entry
  for entry in "${preexisting[@]+"${preexisting[@]}"}"; do
    export "${entry?}"
  done
}

if [[ -n "${ENV_FILE}" ]]; then
  load_env_file "${ENV_FILE}"
elif [[ -f "${ROOT_DIR}/.env" ]]; then
  load_env_file "${ROOT_DIR}/.env"
else
  echo "No .env found. Copy .env.example → .env for local work, or pass --env-file." >&2
  echo "See docs/ENV.md" >&2
  exit 1
fi

: "${CF_ACCOUNT_ID:?Set CF_ACCOUNT_ID (in .env or --env-file)}"
: "${CF_QUEUE_ID:?Set CF_QUEUE_ID (in .env or --env-file)}"
: "${CF_QUEUES_API_TOKEN:?Set CF_QUEUES_API_TOKEN (in .env or --env-file)}"

build_payload_json() {
  if [[ "${EVENT}" != "scrape-shopping-suggestions" ]]; then
    echo "This script only builds payloads for EVENT=scrape-shopping-suggestions." >&2
    echo "For other events, POST a custom {\"event\",\"payload\"} envelope (see docs/PUBLISH_EVENTS.md)." >&2
    exit 1
  fi

  if command -v python3 >/dev/null 2>&1; then
    EVENT="${EVENT}" MARKETPLACE="${MARKETPLACE}" USER_ID="${USER_ID}" TERMS="${TERMS}" python3 - <<'PY'
import json, os

event = os.environ["EVENT"].strip()
marketplace = os.environ["MARKETPLACE"].strip()
userid = os.environ["USER_ID"].strip()
terms = [t.strip() for t in os.environ["TERMS"].split(",") if t.strip()]
if not marketplace or not userid or not terms:
    raise SystemExit("MARKETPLACE, USER_ID and at least one TERMS entry are required")

envelope = {
    "event": event,
    "payload": {
        "marketplace": marketplace,
        "userid": userid,
        "search_terms": terms,
    },
}
print(json.dumps({"body": envelope, "content_type": "json"}, ensure_ascii=False))
PY
    return
  fi

  if command -v jq >/dev/null 2>&1; then
    local terms_json
    terms_json="$(
      IFS=',' read -ra TERM_ARR <<< "${TERMS}"
      printf '%s\n' "${TERM_ARR[@]}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' | jq -R . | jq -s .
    )"
    jq -n \
      --arg event "${EVENT}" \
      --arg marketplace "${MARKETPLACE}" \
      --arg userid "${USER_ID}" \
      --argjson terms "${terms_json}" \
      '{body:{event:$event,payload:{marketplace:$marketplace,userid:$userid,search_terms:$terms}},content_type:"json"}'
    return
  fi

  echo "Need python3 or jq to build the JSON payload safely" >&2
  exit 1
}

REQUEST_BODY="$(build_payload_json)"
URL="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/queues/${CF_QUEUE_ID}/messages"

echo "Publishing to Cloudflare Queues"
echo "  account=${CF_ACCOUNT_ID}"
echo "  queue=${CF_QUEUE_ID}"
echo "  event=${EVENT}"
echo "  body=${REQUEST_BODY}"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "[dry-run] Skipping HTTP POST"
  exit 0
fi

HTTP_CODE="$(
  curl -sS -o /tmp/cf-queues-publish-response.json -w '%{http_code}' \
    -X POST "${URL}" \
    -H "Authorization: Bearer ${CF_QUEUES_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "${REQUEST_BODY}"
)"

echo "HTTP ${HTTP_CODE}"
cat /tmp/cf-queues-publish-response.json
echo

if [[ "${HTTP_CODE}" != "200" ]]; then
  echo "Publish failed" >&2
  exit 1
fi

if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY'
import json, sys
with open("/tmp/cf-queues-publish-response.json", encoding="utf-8") as f:
    data = json.load(f)
if data.get("success") is not True:
    print("Cloudflare API returned success=false", file=sys.stderr)
    sys.exit(1)
print("Done — message accepted by Cloudflare Queues.")
PY
else
  echo "Done (verify success:true in the response above)."
fi
