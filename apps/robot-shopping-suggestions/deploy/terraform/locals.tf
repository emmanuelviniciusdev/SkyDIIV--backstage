data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

locals {
  # All OCI display names use this prefix. Production name is exact;
  # non-production appends environment to avoid compartment collisions.
  name_prefix = var.environment == "production" ? "skydiiv-robot-shopping-suggestions" : "skydiiv-robot-shopping-suggestions-${var.environment}"
  # VCN/subnet DNS labels: max 15 alphanumeric characters
  dns_label = var.environment == "production" ? "skydiivrss" : "skydiivrssstg"

  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[
    var.availability_domain_index
  ].name

  common_tags = {
    app         = "skydiiv-robot-shopping-suggestions"
    brand       = "skydiiv"
    environment = var.environment
    managed_by  = "terraform"
    billing     = "payg"
  }
}
