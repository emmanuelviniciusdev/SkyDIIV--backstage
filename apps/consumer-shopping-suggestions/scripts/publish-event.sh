#!/usr/bin/env bash
# Publish an event to Cloudflare Queues (HTTP push) — default broker for local + production.
#
# Loads credentials from ./.env by default (project root).
# See docs/ENV.md and docs/PUBLISH_EVENTS.md.
#
# Usage:
#   ./scripts/publish-event.sh
#   SEARCH_PARAMS='[{"searchTerm":"vestido","gender":"Female","topSize":"M","bottomSize":"40","footSize":"38"}]' \
#     ./scripts/publish-event.sh
#   MARKETPLACE=enjoei USER_ID=user-42 \
#     TERMS="vestido floral,jaqueta" GENDER=Female TOP_SIZE=M BOTTOM_SIZE=40 FOOT_SIZE=38 \
#     ./scripts/publish-event.sh
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
# Preferred: full searchParams JSON array (one object per term).
SEARCH_PARAMS="${SEARCH_PARAMS:-}"
# Fallback shorthand: comma-separated terms + shared filters applied to every entry.
TERMS="${TERMS:-}"
GENDER="${GENDER:-}"
TOP_SIZE="${TOP_SIZE:-}"
BOTTOM_SIZE="${BOTTOM_SIZE:-}"
FOOT_SIZE="${FOOT_SIZE:-}"
BRAND="${BRAND:-}"

usage() {
  cat <<'EOF'
Publish an event to Cloudflare Queues (default broker).

Options:
  --env-file <path>   Dotenv with CF_* (default: ./.env in the project root)
  --dry-run           Print the request body without calling the API
  -h, --help          Show this help

Env:
  EVENT           Event name (default: scrape-shopping-suggestions)
  MARKETPLACE     For scrape event (default: enjoei)
  USER_ID         For scrape event (default: user-1)

  SEARCH_PARAMS   Preferred — JSON array of SearchParams, one object per term:
                    [{"searchTerm":"vestido","gender":"Female","topSize":"M",
                      "bottomSize":"40","footSize":"38","brand":"Zara"},
                     {"searchTerm":"jaqueta","gender":"Male","topSize":"G",
                      "bottomSize":null,"footSize":null,"brand":null}]

  TERMS           Fallback — comma-separated search terms (shared filters below)
  GENDER          Optional gender applied to every TERMS entry (Female|Male)
  TOP_SIZE        Optional top sizes applied to every TERMS entry, e.g. "M" or "M, G"
  BOTTOM_SIZE     Optional bottom sizes applied to every TERMS entry
  FOOT_SIZE       Optional foot sizes applied to every TERMS entry
  BRAND           Optional brand applied to every TERMS entry

  CF_ACCOUNT_ID / CF_QUEUE_ID / CF_QUEUES_API_TOKEN

When neither SEARCH_PARAMS nor TERMS is set, publishes a default sample entry.
Payload keys are camelCase: marketplace, userId, searchParams[].

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
    EVENT="${EVENT}" MARKETPLACE="${MARKETPLACE}" USER_ID="${USER_ID}" \
      SEARCH_PARAMS="${SEARCH_PARAMS}" TERMS="${TERMS}" \
      GENDER="${GENDER}" TOP_SIZE="${TOP_SIZE}" BOTTOM_SIZE="${BOTTOM_SIZE}" FOOT_SIZE="${FOOT_SIZE}" \
      BRAND="${BRAND}" \
      python3 - <<'PY'
import json
import os


def optional(name):
    value = os.environ.get(name, "").strip()
    return value or None


def normalize_entry(raw, index):
    if not isinstance(raw, dict):
        raise SystemExit(f"SEARCH_PARAMS[{index}] must be an object")

    # Accept legacy "term" alias for convenience.
    if "searchTerm" not in raw and "term" in raw:
        raw = {**raw, "searchTerm": raw["term"]}

    search_term = raw.get("searchTerm")
    if not isinstance(search_term, str) or not search_term.strip():
        raise SystemExit(f"SEARCH_PARAMS[{index}].searchTerm must be a non-empty string")

    entry = {
        "searchTerm": search_term.strip(),
        "gender": raw.get("gender", None),
        "topSize": raw.get("topSize", None),
        "bottomSize": raw.get("bottomSize", None),
        "footSize": raw.get("footSize", None),
        "brand": raw.get("brand", None),
    }

    for key in ("gender", "topSize", "bottomSize", "footSize", "brand"):
        value = entry[key]
        if value is None:
            continue
        if not isinstance(value, str):
            raise SystemExit(f"SEARCH_PARAMS[{index}].{key} must be string or null")
        entry[key] = value.strip() or None

    return entry


def from_search_params_json(raw):
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as err:
        raise SystemExit(f"SEARCH_PARAMS is not valid JSON: {err}") from err

    if not isinstance(parsed, list) or len(parsed) == 0:
        raise SystemExit("SEARCH_PARAMS must be a non-empty JSON array")

    return [normalize_entry(item, i) for i, item in enumerate(parsed)]


def from_terms_shorthand():
    terms = [t.strip() for t in os.environ.get("TERMS", "").split(",") if t.strip()]
    if not terms:
        return []

    gender = optional("GENDER")
    top_size = optional("TOP_SIZE")
    bottom_size = optional("BOTTOM_SIZE")
    foot_size = optional("FOOT_SIZE")
    brand = optional("BRAND")

    return [
        {
            "searchTerm": term,
            "gender": gender,
            "topSize": top_size,
            "bottomSize": bottom_size,
            "footSize": foot_size,
            "brand": brand,
        }
        for term in terms
    ]


event = os.environ["EVENT"].strip()
marketplace = os.environ["MARKETPLACE"].strip()
user_id = os.environ["USER_ID"].strip()
if not marketplace or not user_id:
    raise SystemExit("MARKETPLACE and USER_ID are required")

search_params_raw = os.environ.get("SEARCH_PARAMS", "").strip()
if search_params_raw:
    search_params = from_search_params_json(search_params_raw)
elif os.environ.get("TERMS", "").strip():
    search_params = from_terms_shorthand()
else:
    # Default sample: one SearchParams entry.
    search_params = [
        {
            "searchTerm": "vestido floral",
            "gender": None,
            "topSize": None,
            "bottomSize": None,
            "footSize": None,
            "brand": None,
        }
    ]

envelope = {
    "event": event,
    "payload": {
        "marketplace": marketplace,
        "userId": user_id,
        "searchParams": search_params,
    },
}
print(json.dumps({"body": envelope, "content_type": "json"}, ensure_ascii=False))
PY
    return
  fi

  if command -v jq >/dev/null 2>&1; then
    if [[ -n "${SEARCH_PARAMS}" ]]; then
      # Normalize optional "term" → "searchTerm" and fill missing nullable fields.
      local normalized
      normalized="$(
        jq -e '
          if (type != "array") or (length < 1) then
            error("SEARCH_PARAMS must be a non-empty JSON array")
          else
            map(
              (if has("searchTerm") then . else . + {searchTerm: .term} end)
              | if (.searchTerm | type != "string") or (.searchTerm | length < 1) then
                  error("each SEARCH_PARAMS entry needs a non-empty searchTerm")
                else
                  {
                    searchTerm: .searchTerm,
                    gender: (.gender // null),
                    topSize: (.topSize // null),
                    bottomSize: (.bottomSize // null),
                    footSize: (.footSize // null),
                    brand: (.brand // null)
                  }
                end
            )
          end
        ' <<<"${SEARCH_PARAMS}"
      )" || {
        echo "Invalid SEARCH_PARAMS JSON" >&2
        exit 1
      }
      jq -n \
        --arg event "${EVENT}" \
        --arg marketplace "${MARKETPLACE}" \
        --arg userId "${USER_ID}" \
        --argjson searchParams "${normalized}" \
        '{
          body: {
            event: $event,
            payload: {
              marketplace: $marketplace,
              userId: $userId,
              searchParams: $searchParams
            }
          },
          content_type: "json"
        }'
      return
    fi

    local terms_json
    if [[ -n "${TERMS}" ]]; then
      terms_json="$(
        IFS=',' read -ra TERM_ARR <<< "${TERMS}"
        printf '%s\n' "${TERM_ARR[@]}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' | jq -R . | jq -s .
      )"
    else
      terms_json='["vestido floral"]'
    fi

    jq -n \
      --arg event "${EVENT}" \
      --arg marketplace "${MARKETPLACE}" \
      --arg userId "${USER_ID}" \
      --argjson terms "${terms_json}" \
      --arg gender "${GENDER}" \
      --arg topSize "${TOP_SIZE}" \
      --arg bottomSize "${BOTTOM_SIZE}" \
      --arg footSize "${FOOT_SIZE}" \
      --arg brand "${BRAND}" \
      '{
        body: {
          event: $event,
          payload: {
            marketplace: $marketplace,
            userId: $userId,
            searchParams: (
              $terms | map({
                searchTerm: .,
                gender: (if $gender == "" then null else $gender end),
                topSize: (if $topSize == "" then null else $topSize end),
                bottomSize: (if $bottomSize == "" then null else $bottomSize end),
                footSize: (if $footSize == "" then null else $footSize end),
                brand: (if $brand == "" then null else $brand end)
              })
            )
          }
        },
        content_type: "json"
      }'
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
