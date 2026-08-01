#!/usr/bin/env bash
# Initialize Terraform against the shared OCI Object Storage remote state.
#
# Local (either):
#   - keep deploy/terraform/backend.hcl (auto-detected), or
#   - set TF_BACKEND_HCL=deploy/terraform/backend.hcl in deploy/local.env
#
# CI (required — avoids quote stripping on multiline secrets):
#   base64 < deploy/terraform/backend.hcl | tr -d '\n' | \
#     gh secret set TF_BACKEND_HCL_B64 --env production
#
# Local and GitHub Actions must share this bucket state. Missing backend config
# is a hard error (no local terraform.tfstate fallback).
#
# First-time migration from a leftover local terraform.tfstate:
#   TF_BACKEND_MIGRATE=1 ./deploy/terraform-init.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${ROOT}/deploy/terraform"
cd "${TF_DIR}"

write_backend_hcl_from_env() {
  umask 077
  if [[ -n "${TF_BACKEND_HCL_B64:-}" ]]; then
    echo "Using TF_BACKEND_HCL_B64 for remote state" >&2
    if ! printf '%s' "${TF_BACKEND_HCL_B64}" | base64 -d > backend.hcl 2>/dev/null; then
      echo "TF_BACKEND_HCL_B64 is not valid base64" >&2
      exit 1
    fi
    printf '%s\n' "${TF_DIR}/backend.hcl"
    return 0
  fi

  local cfg="${TF_BACKEND_HCL:-}"
  if [[ -z "${cfg}" && -f "${TF_DIR}/backend.hcl" ]]; then
    echo "Using ${TF_DIR}/backend.hcl for remote state" >&2
    printf '%s\n' "${TF_DIR}/backend.hcl"
    return 0
  fi

  [[ -n "${cfg}" ]] || return 1

  # Multiline or HCL-shaped body — not a filesystem path.
  if [[ "${cfg}" == *$'\n'* ]] || [[ "${cfg}" =~ ^[[:space:]]*(#|bucket[[:space:]]*=) ]]; then
    echo "Using TF_BACKEND_HCL env body for remote state" >&2
    printf '%s' "${cfg}" > backend.hcl
    [[ "${cfg}" == *$'\n' ]] || printf '\n' >> backend.hcl
    printf '%s\n' "${TF_DIR}/backend.hcl"
    return 0
  fi

  if [[ -f "${cfg}" ]]; then
    echo "Using TF_BACKEND_HCL path ${cfg}" >&2
    printf '%s\n' "${cfg}"
    return 0
  fi
  if [[ -f "${ROOT}/${cfg}" ]]; then
    echo "Using TF_BACKEND_HCL path ${ROOT}/${cfg}" >&2
    printf '%s\n' "${ROOT}/${cfg}"
    return 0
  fi

  echo "Using TF_BACKEND_HCL env body for remote state" >&2
  printf '%s' "${cfg}" > backend.hcl
  printf '\n' >> backend.hcl
  printf '%s\n' "${TF_DIR}/backend.hcl"
}

# GitHub Actions often strips " from multiline secrets when injecting them into
# env. Re-quote known string keys so terraform init does not fail.
repair_backend_hcl_quotes() {
  local file="$1"
  python3 - "$file" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()
string_keys = {
    "bucket",
    "key",
    "region",
    "endpoint",
    "access_key",
    "secret_key",
}
pattern = re.compile(
    r'^(\s*)(' + "|".join(string_keys) + r')(\s*=\s*)(.*?)(\s*)$'
)
repaired = []
changed = []
for line in text.splitlines():
    match = pattern.match(line)
    if not match:
        repaired.append(line)
        continue
    indent, key, eq, value, trailing = match.groups()
    raw = value.strip()
    if not raw or raw.startswith("#"):
        repaired.append(line)
        continue
    if (raw.startswith('"') and raw.endswith('"')) or (
        raw.startswith("'") and raw.endswith("'")
    ):
        repaired.append(line)
        continue
    # Drop a dangling comment so we don't quote it into the value.
    if " #" in raw:
        raw = raw.split(" #", 1)[0].rstrip()
    repaired.append(f'{indent}{key}{eq}"{raw}"{trailing}')
    changed.append(key)

path.write_text("\n".join(repaired) + ("\n" if text.endswith("\n") or repaired else ""))
if changed:
    print(
        "Re-quoted unquoted backend.hcl keys: " + ", ".join(changed),
        file=sys.stderr,
    )
PY
}

validate_backend_hcl() {
  local file="$1"
  local bad
  bad="$(python3 - "$file" <<'PY'
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text()
string_keys = {"bucket", "key", "region", "endpoint", "access_key", "secret_key"}
pattern = re.compile(
    r'^\s*(' + "|".join(string_keys) + r')\s*=\s*(.*?)\s*$'
)
bad = []
for line in text.splitlines():
    match = pattern.match(line)
    if not match:
        continue
    key, value = match.groups()
    raw = value.strip()
    if not raw or raw.startswith("#"):
        continue
    if (raw.startswith('"') and raw.endswith('"')) or (
        raw.startswith("'") and raw.endswith("'")
    ):
        continue
    bad.append(key)
if bad:
    print(", ".join(bad))
PY
)"
  if [[ -n "${bad}" ]]; then
    cat >&2 <<EOF
backend.hcl still has unquoted string keys: ${bad}

Re-set the CI secret from a quoted local file:

  base64 < deploy/terraform/backend.hcl | tr -d '\n' | \\
    gh secret set TF_BACKEND_HCL_B64 --env production
EOF
    exit 1
  fi
}

if backend_config="$(write_backend_hcl_from_env)"; then
  repair_backend_hcl_quotes "${backend_config}"
  validate_backend_hcl "${backend_config}"
  if [[ "${TF_BACKEND_MIGRATE:-}" == "1" || "${TF_BACKEND_MIGRATE:-}" == "true" ]]; then
    terraform init -input=false -reconfigure -migrate-state -backend-config="${backend_config}"
  else
    terraform init -input=false -reconfigure -backend-config="${backend_config}"
  fi
else
  cat >&2 <<'EOF'
Remote Terraform state is required (OCI Object Storage). Local deploy and GitHub
Actions must share the same bucket — local terraform.tfstate is not supported.

Local:
  cp deploy/terraform/backend.hcl.example deploy/terraform/backend.hcl
  # fill bucket / endpoint / customer secret keys, then either keep the file
  # (auto-detected) or set in deploy/local.env:
  #   TF_BACKEND_HCL=deploy/terraform/backend.hcl

CI (production environment):
  base64 < deploy/terraform/backend.hcl | tr -d '\n' | \
    gh secret set TF_BACKEND_HCL_B64 --env production
EOF
  exit 1
fi
