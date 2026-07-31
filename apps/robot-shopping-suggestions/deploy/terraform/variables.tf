variable "tenancy_ocid" {
  type        = string
  description = "OCI tenancy OCID"
}

variable "user_ocid" {
  type        = string
  description = "OCI API user OCID"
}

variable "fingerprint" {
  type        = string
  description = "API key fingerprint"
}

variable "private_key_path" {
  type        = string
  description = "Path to the OCI API private key PEM file"
}

variable "region" {
  type        = string
  description = "OCI home region — default US East (Ashburn)."
  default     = "us-ashburn-1"
}

variable "compartment_ocid" {
  type        = string
  description = "Compartment OCID for all resources"
}

variable "environment" {
  type        = string
  description = "Deployment environment label (staging|production)"
  default     = "production"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "availability_domain_index" {
  type        = number
  description = "Availability domain index (0-based)."
  default     = 0
}

variable "container_shape" {
  type        = string
  description = "Container Instance shape (Ampere A1 Flex by default)."
  default     = "CI.Standard.A1.Flex"
}

variable "container_ocpus" {
  type        = number
  description = "OCPUs for the Container Instance."
  default     = 2

  validation {
    condition     = var.container_ocpus >= 1 && var.container_ocpus <= 8
    error_message = "container_ocpus must be between 1 and 8."
  }
}

variable "container_memory_in_gbs" {
  type        = number
  description = "Memory (GB) for the Container Instance. Prefer >= 4 GB for Camoufox."
  default     = 4

  validation {
    condition     = var.container_memory_in_gbs >= 1 && var.container_memory_in_gbs <= 64
    error_message = "container_memory_in_gbs must be between 1 and 64."
  }
}

variable "container_image_url" {
  type        = string
  description = "Full OCIR image URL for the robot (region.ocir.io/ns/repo:tag)."
}

variable "robot_env" {
  type        = map(string)
  description = <<-EOT
    Application environment variables injected into the Container Instance
    (CF_*, DATABASE_URL, WEB_APP_REDIS_*, OCI_API_PRIVATE_KEY, etc.).
    Do not commit secrets — pass via TF_VAR_robot_env / GitHub Actions.
  EOT
  default     = {}
  sensitive   = true

  # PROXY_URLS must point at an external proxy: the Container Instance runs no
  # sidecar, so a loopback URL makes every Camoufox navigation fail to connect.
  validation {
    condition = !can(regex(
      "127\\.0\\.0\\.1|localhost|\\[::1\\]",
      lookup(var.robot_env, "PROXY_URLS", ""),
    ))
    error_message = "robot_env.PROXY_URLS points at loopback. Clear it or use an external proxy — the Container Instance has no local SOCKS listener."
  }
}

variable "robot_batch_size" {
  type        = number
  description = "Max messages pulled per drain cycle (default 2)."
  default     = 2

  validation {
    condition     = var.robot_batch_size >= 1 && var.robot_batch_size <= 10
    error_message = "robot_batch_size must be between 1 and 10."
  }
}

variable "robot_concurrency" {
  type        = number
  description = "Max in-flight messages within a pull batch (default 2)."
  default     = 2

  validation {
    condition     = var.robot_concurrency >= 1 && var.robot_concurrency <= 10
    error_message = "robot_concurrency must be between 1 and 10."
  }
}

variable "network_mode" {
  type        = string
  description = <<-EOT
    How the Container Instance reaches OCIR:
      public  — public subnet + Internet Gateway + ephemeral public IP (no NAT cost)
      private — private subnet + NAT Gateway + Service Gateway (NAT billed hourly)
  EOT
  default     = "public"

  validation {
    condition     = contains(["public", "private"], var.network_mode)
    error_message = "network_mode must be public or private."
  }
}

variable "vcn_cidr" {
  type        = string
  description = "IPv4 CIDR for the VCN"
  default     = "10.10.0.0/16"
}

variable "subnet_cidr" {
  type        = string
  description = "IPv4 CIDR for the public subnet (network_mode = public)"
  default     = "10.10.1.0/24"
}

variable "private_subnet_cidr" {
  type        = string
  description = "IPv4 CIDR for the private subnet (network_mode = private)"
  default     = "10.10.2.0/24"
}

variable "ocir_username" {
  type        = string
  description = "OCIR pull username (<namespace>/<email> — same as docker login -u)."
  default     = ""
}

variable "ocir_auth_token" {
  type        = string
  description = "OCIR auth token used as image_pull_secrets password."
  default     = ""
  sensitive   = true
}

variable "ocir_registry_endpoint" {
  type        = string
  description = <<-EOT
    Override for the image_pull_secrets registry endpoint. Empty derives the
    bare host from container_image_url (e.g. us-ashburn-1.ocir.io). Only used
    for non-OCIR registries — private OCIR pulls use the resource principal.
  EOT
  default     = ""
}

variable "create_ocir_pull_policy" {
  type        = bool
  description = <<-EOT
    Create the tenancy-level dynamic group + policy that lets Container
    Instances read OCIR repositories. Required for private OCIR images; needs a
    tenancy administrator. Disable if the policy already exists out-of-band.
  EOT
  default     = true
}

variable "ocir_policy_propagation_wait" {
  type        = string
  description = <<-EOT
    How long to wait after creating the OCIR pull policy before launching the
    Container Instance, so IAM has propagated. Terraform duration string.
  EOT
  default     = "90s"
}

variable "ssh_ingress_cidr" {
  type        = string
  description = "Legacy unused — Container Instance has no SSH. Kept for tfvars compat."
  default     = "0.0.0.0/0"
}

variable "ssh_public_key" {
  type        = string
  description = "Legacy unused — Container Instance has no SSH. Kept for tfvars compat."
  default     = ""
}

variable "enable_cost_limit" {
  type        = bool
  description = <<-EOT
    When true, create an OCI monthly Budget (+ email alerts) for cost_limit_usd.
    Hard enforcement (terraform destroy) is performed by deploy/oci_cost_guard.py.
  EOT
  default     = true
}

variable "cost_limit_usd" {
  type        = number
  description = "Monthly spend ceiling in USD."
  default     = 5

  validation {
    condition     = var.cost_limit_usd > 0 && var.cost_limit_usd <= 1000
    error_message = "cost_limit_usd must be between 0 (exclusive) and 1000."
  }
}

variable "cost_alert_email" {
  type        = string
  description = "Email recipient for OCI Budget alert rules."
  default     = "emmanuel.bergmann@icloud.com"
}
