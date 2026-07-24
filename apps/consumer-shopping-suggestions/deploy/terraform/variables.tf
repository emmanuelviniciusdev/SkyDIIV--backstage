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
  description = "OCI home region (compute should run in the home region)"
}

variable "compartment_ocid" {
  type        = string
  description = "Compartment OCID for all resources (often the tenancy OCID)"
}

variable "ssh_public_key" {
  type        = string
  description = "SSH public key installed on the compute instance"
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
  description = "Availability domain index (0-based). Change if capacity is exhausted in the default AD."
  default     = 0
}

variable "instance_shape" {
  type        = string
  description = "Compute shape. Default VM.Standard.A1.Flex (Ampere, pay-as-you-go)."
  default     = "VM.Standard.A1.Flex"

  validation {
    condition = contains([
      "VM.Standard.A1.Flex",
      "VM.Standard.E2.1.Micro",
      "VM.Standard.E4.Flex",
    ], var.instance_shape)
    error_message = "instance_shape must be VM.Standard.A1.Flex, VM.Standard.E2.1.Micro, or VM.Standard.E4.Flex."
  }
}

variable "instance_ocpus" {
  type        = number
  description = "OCPUs for flexible shapes (A1.Flex / E4.Flex)."
  default     = 2

  validation {
    condition     = var.instance_ocpus >= 1 && var.instance_ocpus <= 8
    error_message = "instance_ocpus must be between 1 and 8."
  }
}

variable "instance_memory_in_gbs" {
  type        = number
  description = "Memory (GB) for flexible shapes. Prefer >= 4 GB for Camoufox scraping."
  default     = 4

  validation {
    condition     = var.instance_memory_in_gbs >= 1 && var.instance_memory_in_gbs <= 64
    error_message = "instance_memory_in_gbs must be between 1 and 64."
  }
}

variable "boot_volume_size_in_gbs" {
  type        = number
  description = "Boot volume size in GB (OCI minimum ~47)."
  default     = 50

  validation {
    condition     = var.boot_volume_size_in_gbs >= 47 && var.boot_volume_size_in_gbs <= 200
    error_message = "boot_volume_size_in_gbs must be between 47 and 200."
  }
}

variable "operating_system" {
  type        = string
  description = "OS for the image lookup"
  default     = "Canonical Ubuntu"
}

variable "operating_system_version" {
  type        = string
  description = "OS version for the image lookup"
  default     = "24.04"
}

variable "vcn_cidr" {
  type        = string
  description = "IPv4 CIDR for the VCN"
  default     = "10.10.0.0/16"
}

variable "subnet_cidr" {
  type        = string
  description = "IPv4 CIDR for the public subnet"
  default     = "10.10.1.0/24"
}

variable "ssh_ingress_cidr" {
  type        = string
  description = "CIDR allowed to SSH into the instance (restrict in production if possible)"
  default     = "0.0.0.0/0"
}

variable "ipv6_count" {
  type        = number
  description = "Number of extra public IPv6 addresses for egress rotation (in addition to the primary VNIC address)"
  default     = 4

  validation {
    condition     = var.ipv6_count >= 1 && var.ipv6_count <= 32
    error_message = "ipv6_count must be between 1 and 32."
  }
}

variable "proxy_base_port" {
  type        = number
  description = "Base local SOCKS port used by microsocks on the VM"
  default     = 11080
}

variable "enable_weekly_schedule" {
  type        = bool
  description = <<-EOT
    When true, OCI Resource Scheduler starts the VM every Thursday 11:00 and stops
    it at 12:00 (America/Sao_Paulo → UTC crons below). Set false for test/staging
    deploys so the schedule does not apply (VM stays under manual control).
  EOT
  default     = true
}

variable "schedule_start_cron_utc" {
  type        = string
  description = "CRON (UTC) to START the VM. Default: Thursday 11:00 America/Sao_Paulo = 14:00 UTC."
  default     = "0 14 * * 4"
}

variable "schedule_stop_cron_utc" {
  type        = string
  description = "CRON (UTC) to STOP the VM. Default: Thursday 12:00 America/Sao_Paulo = 15:00 UTC."
  default     = "0 15 * * 4"
}

variable "create_resource_scheduler_policy" {
  type        = bool
  description = "Create an Identity policy so Resource Scheduler can start/stop the instance."
  default     = true
}

variable "enable_cost_limit" {
  type        = bool
  description = <<-EOT
    When true, create an OCI monthly Budget (+ email alerts) for cost_limit_usd.
    Hard enforcement (terraform destroy of the consumer stack: VM, network, IPv6,
    schedules, budget) is performed by deploy/oci_cost_guard.py (GitHub Actions
    cron), because Budgets alone only notify.
  EOT
  default     = true
}

variable "cost_limit_usd" {
  type        = number
  description = "Monthly spend ceiling in USD. When Usage API MTD cost >= this, cost guard destroys the consumer Terraform stack."
  default     = 5

  validation {
    condition     = var.cost_limit_usd > 0 && var.cost_limit_usd <= 1000
    error_message = "cost_limit_usd must be between 0 (exclusive) and 1000."
  }
}

variable "cost_alert_email" {
  type        = string
  description = "Email recipient for OCI Budget alert rules (required when enable_cost_limit is true)."
  default     = "emmanuel.bergmann@icloud.com"
}
