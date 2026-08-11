#!/usr/bin/env bash
# OCI Object Storage is S3-compatible but rejects AWS SDK v2 default
# aws-chunked PutObject (501 NotImplemented). Terraform's skip_s3_checksum
# alone does not disable request checksums on recent Terraform / AWS SDK
# versions (see hashicorp/terraform#38337).
#
# Source this before any terraform command that reads/writes remote state:
#   # shellcheck disable=SC1091
#   source "${ROOT}/deploy/oci-s3-backend-env.sh"
#
# Safe to source multiple times.
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"
