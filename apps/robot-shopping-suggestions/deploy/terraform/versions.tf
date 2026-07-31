terraform {
  required_version = ">= 1.5.0"

  # Values supplied at init time via backend.hcl or the TF_BACKEND_HCL secret.
  backend "s3" {}

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 6.0.0"
    }
    # Only used to wait out OCI IAM propagation before the image pull.
    time = {
      source  = "hashicorp/time"
      version = ">= 0.9.0"
    }
  }

  # Optional: configure a remote backend in CI via TF_BACKEND_HCL secret.
}
