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
  description = "OCI home region (Always Free compute must be in the home region)"
}

variable "compartment_ocid" {
  type        = string
  description = "Compartment OCID for all resources (often the tenancy OCID for free accounts)"
}

variable "ssh_public_key" {
  type        = string
  description = "SSH public key installed on the Always Free instance"
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
  description = "Availability domain index (0-based). Change if Ampere capacity is exhausted in the default AD."
  default     = 0
}

variable "instance_shape" {
  type        = string
  description = "Always Free–eligible shape. Prefer VM.Standard.A1.Flex (Ampere). Alternative: VM.Standard.E2.1.Micro (AMD)."
  default     = "VM.Standard.A1.Flex"

  validation {
    condition = contains([
      "VM.Standard.A1.Flex",
      "VM.Standard.E2.1.Micro",
    ], var.instance_shape)
    error_message = "instance_shape must be an Always Free–eligible shape (VM.Standard.A1.Flex or VM.Standard.E2.1.Micro)."
  }
}

variable "instance_ocpus" {
  type        = number
  description = "OCPUs for A1.Flex. Always Free tenancies: max 2 total. Paid accounts Always Free A1 entitlement: up to 4."
  default     = 2

  validation {
    condition     = var.instance_ocpus >= 1 && var.instance_ocpus <= 4
    error_message = "instance_ocpus must be between 1 and 4 (Always Free Ampere cap)."
  }
}

variable "instance_memory_in_gbs" {
  type        = number
  description = "Memory (GB) for A1.Flex. Always Free tenancies: max 12 total. Paid Always Free A1 entitlement: up to 24."
  default     = 12

  validation {
    condition     = var.instance_memory_in_gbs >= 1 && var.instance_memory_in_gbs <= 24
    error_message = "instance_memory_in_gbs must be between 1 and 24 (Always Free Ampere cap)."
  }
}

variable "boot_volume_size_in_gbs" {
  type        = number
  description = "Boot volume size in GB (Always Free block storage pool is 200 GB total; minimum ~47)."
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
