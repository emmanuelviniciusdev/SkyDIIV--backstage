/**
 * Always Free compute instance (Ampere A1 Flex by default).
 */

resource "oci_core_instance" "consumer" {
  compartment_id      = var.compartment_ocid
  availability_domain = local.availability_domain
  display_name        = "${local.name_prefix}-vm"
  shape               = var.instance_shape

  dynamic "shape_config" {
    for_each = local.is_ampere ? [1] : []
    content {
      ocpus         = var.instance_ocpus
      memory_in_gbs = var.instance_memory_in_gbs
    }
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    display_name     = "${local.name_prefix}-vnic"
    assign_public_ip = true
    hostname_label   = "consumer"
  }

  source_details {
    source_type             = "image"
    source_id               = local.image_id
    boot_volume_size_in_gbs = var.boot_volume_size_in_gbs
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
      ssh_user = local.ssh_user
    }))
  }

  freeform_tags = merge(local.common_tags, {
    shape = var.instance_shape
  })

  lifecycle {
    precondition {
      condition     = length(data.oci_core_images.os.images) > 0
      error_message = "No OCI image found for ${var.operating_system} ${var.operating_system_version} + shape ${var.instance_shape}."
    }

    ignore_changes = [
      # Avoid recreation when OCI publishes a newer image of the same OS.
      source_details[0].source_id,
    ]
  }
}

data "oci_core_vnic_attachments" "consumer" {
  compartment_id = var.compartment_ocid
  instance_id    = oci_core_instance.consumer.id
}

locals {
  vnic_id = data.oci_core_vnic_attachments.consumer.vnic_attachments[0].vnic_id
}

data "oci_core_vnic" "consumer" {
  vnic_id = local.vnic_id
}
