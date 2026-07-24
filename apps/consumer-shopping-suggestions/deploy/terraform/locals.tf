data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "os" {
  compartment_id           = var.compartment_ocid
  operating_system         = var.operating_system
  operating_system_version = var.operating_system_version
  shape                    = var.instance_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

locals {
  name_prefix = "css-${var.environment}" # legacy OCI resource prefix (consumer-shopping-suggestions)
  # VCN/subnet DNS labels: max 15 alphanumeric characters
  dns_label = "css${var.environment == "production" ? "prod" : "stg"}"

  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[
    var.availability_domain_index
  ].name

  image_id = length(data.oci_core_images.os.images) > 0 ? data.oci_core_images.os.images[0].id : null

  # Ubuntu → ubuntu, Oracle Linux → opc
  ssh_user = startswith(var.operating_system, "Canonical Ubuntu") ? "ubuntu" : "opc"

  common_tags = {
    app         = "consumer-shopping-suggestions"
    environment = var.environment
    managed_by  = "terraform"
    billing     = "payg"
  }

  is_ampere = contains([
    "VM.Standard.A1.Flex",
  ], var.instance_shape)

  is_flex = contains([
    "VM.Standard.A1.Flex",
    "VM.Standard.E4.Flex",
  ], var.instance_shape)
}
