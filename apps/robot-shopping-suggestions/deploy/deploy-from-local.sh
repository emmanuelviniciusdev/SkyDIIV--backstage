#!/usr/bin/env bash
# Local helper for the robot Terraform stack (Container Instance + OCIR).
#
# Setup (once):
#   cp deploy/terraform/terraform.tfvars.example deploy/terraform/terraform.tfvars
#   cp deploy/local.env.example deploy/local.env
#   cp .env.example .env
#
# Usage:
#   ./deploy/deploy-from-local.sh apply                 # build+push OCIR (arm64) → terraform apply
#   ./deploy/deploy-from-local.sh apply --skip-build    # terraform only
#   ./deploy/deploy-from-local.sh apply --smoke-test    # tiny busybox in OCIR (isolates image size)
#   ./deploy/deploy-from-local.sh apply --public-image  # Docker Hub busybox, no pull secret (isolates OCIR auth)
#   ./deploy/deploy-from-local.sh destroy
#
# Network mode is a Terraform variable; override per run without editing files:
#   TF_VAR_network_mode=private ./deploy/deploy-from-local.sh apply --public-image
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${ROOT}/deploy/terraform"
ACTION="${1:-}"
SKIP_BUILD=false
IMAGE_MODE=robot

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=true; shift ;;
    --smoke-test) IMAGE_MODE=smoke; shift ;;
    --public-image) IMAGE_MODE=public; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${ACTION}" ]]; then
  echo "Usage: $0 <apply|destroy> [--skip-build] [--smoke-test|--public-image]" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "${ROOT}/deploy/local-deploy-env.sh"

# Ampere A1 Container Instance requires linux/arm64
IMAGE_PLATFORM="${IMAGE_PLATFORM:-linux/arm64}"

require_apply_inputs() {
  if [[ "${IMAGE_MODE}" != "public" ]]; then
    if [[ -z "${TF_VAR_container_image_url:-}" ]]; then
      echo "Set TF_VAR_container_image_url in deploy/local.env" >&2
      exit 1
    fi
    if [[ "${TF_VAR_container_image_url}" == *"<"* ]] \
      || [[ "${TF_VAR_container_image_url}" == *"YOUR_OCIR_NAMESPACE"* ]]; then
      echo "Replace OCIR placeholders in deploy/local.env (image URL)." >&2
      exit 1
    fi
    if [[ -z "${TF_VAR_ocir_username:-}" || -z "${TF_VAR_ocir_auth_token:-}" ]]; then
      echo "Set TF_VAR_ocir_username and TF_VAR_ocir_auth_token in deploy/local.env" >&2
      exit 1
    fi
    if [[ "${TF_VAR_ocir_username}" == *"YOUR_OCIR_NAMESPACE"* ]] \
      || [[ "${TF_VAR_ocir_auth_token}" == *"YOUR_AUTH_TOKEN"* ]]; then
      echo "Replace OCIR username/token placeholders in deploy/local.env" >&2
      exit 1
    fi
  fi
  if [[ ! -f "${TF_DIR}/terraform.tfvars" ]]; then
    echo "Missing deploy/terraform/terraform.tfvars — copy from terraform.tfvars.example" >&2
    exit 1
  fi
  # terraform.tfvars outranks TF_VAR_*; the image must come from deploy/local.env
  if grep -qE '^\s*container_image_url\s*=' "${TF_DIR}/terraform.tfvars"; then
    echo "Remove 'container_image_url' from deploy/terraform/terraform.tfvars — it overrides deploy/local.env." >&2
    exit 1
  fi
  if [[ ! -f "${OCI_API_PRIVATE_KEY_PATH}" ]]; then
    echo "Missing OCI API private key: ${OCI_API_PRIVATE_KEY_PATH}" >&2
    exit 1
  fi
  if [[ "${IMAGE_MODE}" == "robot" && ! -f "${ROOT}/.env" ]]; then
    echo "Missing ${ROOT}/.env — cp .env.example .env and fill app secrets." >&2
    exit 1
  fi
  if [[ "${IMAGE_MODE}" != "public" ]] && ! command -v docker >/dev/null 2>&1; then
    echo "docker is required to build/push the OCIR image" >&2
    exit 1
  fi
  if ! command -v terraform >/dev/null 2>&1; then
    echo "terraform is required" >&2
    exit 1
  fi
}

# Pushes a minimal image to the same OCIR repo. If the Container Instance can
# pull this but not the robot image, the blocker is image size/content rather
# than VCN routing or OCIR credentials.
push_smoke_test_image() {
  local image registry
  image="${TF_VAR_container_image_url%:*}:smoke-test"
  registry="${image%%/*}"

  echo "==> OCIR login (${registry})"
  echo "${TF_VAR_ocir_auth_token}" | docker login "${registry}" \
    -u "${TF_VAR_ocir_username}" \
    --password-stdin

  echo "==> Push smoke-test image ${image}"
  docker buildx build \
    --platform "${IMAGE_PLATFORM}" \
    --provenance=false \
    --sbom=false \
    --output "type=image,name=${image},push=true" \
    - <<'DOCKERFILE'
FROM busybox:1.36
CMD ["sh", "-c", "echo robot smoke test ok; sleep 30"]
DOCKERFILE

  export TF_VAR_container_image_url="${image}"
  echo "Smoke-test image ready: ${image}"
}

# Public Docker Hub image, no image_pull_secrets and no OCIR involvement.
# Succeeds → VCN egress is fine and the blocker is OCIR auth/registry endpoint.
# Fails    → the blocker is the VCN (routing, gateway or security list).
use_public_image() {
  export TF_VAR_container_image_url="docker.io/library/busybox:1.36"
  export TF_VAR_ocir_username=""
  export TF_VAR_ocir_auth_token=""
  echo "==> Public-image probe: ${TF_VAR_container_image_url} (no pull secret)"
}

build_and_push_image() {
  local image registry
  image="${TF_VAR_container_image_url}"
  registry="${image%%/*}"

  echo "==> OCIR login (${registry})"
  echo "${TF_VAR_ocir_auth_token}" | docker login "${registry}" \
    -u "${TF_VAR_ocir_username}" \
    --password-stdin

  # Container Instances cannot pull buildx manifest lists with attestations —
  # force a single-arch image manifest.
  build_args=(
    --platform "${IMAGE_PLATFORM}"
    --provenance=false
    --sbom=false
    --output "type=image,name=${image},push=true"
  )
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    build_args+=(--build-arg "GITHUB_TOKEN=${GITHUB_TOKEN}")
  fi
  echo "==> Build & push ${image} (${IMAGE_PLATFORM}, no attestations)"
  docker buildx build "${build_args[@]}" "${ROOT}"

  echo "==> Verify remote manifest"
  local media_type
  media_type="$(docker manifest inspect "${image}" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("mediaType",""))' 2>/dev/null || true)"
  if [[ -z "${media_type}" ]]; then
    echo "Could not inspect remote manifest for ${image}" >&2
    exit 1
  fi
  if [[ "${media_type}" == *"manifest.list"* ]] || [[ "${media_type}" == *"image.index"* ]]; then
    echo "Pushed a manifest list (${media_type}) — Container Instances requires a single image manifest." >&2
    exit 1
  fi
  echo "Image ready: ${image} (${media_type})"
}

cost_ceiling_gate() {
  local limit="${COST_LIMIT_USD:-5}"
  if [[ -z "${OCI_TENANCY_OCID:-}" || ! -f "${OCI_API_PRIVATE_KEY_PATH}" ]]; then
    echo "Skipping cost ceiling gate (set OCI ids in terraform.tfvars + private_key_path)." >&2
    return 0
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 required for cost ceiling gate" >&2
    exit 1
  fi
  set +e
  python3 "${ROOT}/deploy/oci_cost_guard.py" --check-only --limit "${limit}"
  local code=$?
  set -e
  if [[ "${code}" -eq 10 ]]; then
    echo "Monthly cost ceiling already reached (\$${limit}) — refusing terraform apply" >&2
    exit 1
  fi
  if [[ "${code}" -ne 0 ]]; then
    echo "Cost ceiling check failed (exit ${code})" >&2
    exit "${code}"
  fi
}

CI_ADDRESS="oci_container_instances_container_instance.robot"

# A Container Instance left tainted/FAILED cannot be deleted by the OCI work
# request, so terraform apply/destroy fails on it. Dropping it from state is
# safe: compute already stopped billing, and the VCN teardown continues.
drop_unusable_container_instance() {
  terraform state list 2>/dev/null | grep -q "^${CI_ADDRESS}$" || return 0

  local unusable
  unusable="$(terraform show -json 2>/dev/null | python3 - <<'PY' || echo false
import json, sys

try:
    doc = json.load(sys.stdin)
except Exception:
    print("false")
    raise SystemExit

resources = doc.get("values", {}).get("root_module", {}).get("resources", [])
for resource in resources:
    if resource.get("type") != "oci_container_instances_container_instance":
        continue
    if resource.get("tainted"):
        print("true")
        break
    if resource.get("values", {}).get("state") in {"FAILED", "INACTIVE", "DELETED"}:
        print("true")
        break
else:
    print("false")
PY
)"

  if [[ "${unusable}" == "true" ]]; then
    echo "==> Dropping unusable Container Instance from Terraform state"
    terraform state rm "${CI_ADDRESS}" >/dev/null 2>&1 || true
  fi
}

case "${ACTION}" in
  apply)
    require_apply_inputs
    case "${IMAGE_MODE}" in
      public) use_public_image ;;
      smoke) push_smoke_test_image ;;
      robot)
        if [[ "${SKIP_BUILD}" == "true" ]]; then
          echo "==> Skipping image build (--skip-build)"
        else
          build_and_push_image
        fi
        ;;
    esac
    cost_ceiling_gate
    cd "${TF_DIR}"
    terraform init -input=false -backend=false
    drop_unusable_container_instance
    echo "==> terraform apply (network_mode=${TF_VAR_network_mode:-public}, image ${TF_VAR_container_image_url})"
    # -var beats terraform.tfvars, so deploy/local.env always wins for the image
    "${ROOT}/deploy/tf-apply.sh" \
      -var "container_image_url=${TF_VAR_container_image_url}" \
      -var "ocir_username=${TF_VAR_ocir_username}" \
      -var "ocir_auth_token=${TF_VAR_ocir_auth_token}"
    terraform output
    ;;
  destroy)
    cd "${TF_DIR}"
    terraform init -input=false -backend=false
    # Sync state first: a Container Instance that failed to create is recorded as
    # CREATING locally, and only a refresh reveals the FAILED state that makes
    # the OCI delete work request fail.
    terraform apply -refresh-only -auto-approve -input=false >/dev/null 2>&1 || true
    drop_unusable_container_instance
    set +e
    terraform destroy -auto-approve -input=false
    code=$?
    set -e
    if [[ "${code}" -ne 0 ]]; then
      echo "==> Destroy failed — dropping Container Instance from state and retrying" >&2
      terraform state rm "${CI_ADDRESS}" >/dev/null 2>&1 || true
      terraform destroy -auto-approve -input=false
    fi
    ;;
  *)
    echo "Unknown action: ${ACTION}" >&2
    exit 1
    ;;
esac
