/**
 * Authorization for the Container Instance to pull its image from OCIR.
 *
 * Container Instances authenticate against Container Registry with their own
 * resource principal — `image_pull_secrets` is only consulted for external
 * registries (Docker Hub, GHCR...). Without the dynamic group + `read repos`
 * policy below, OCIR refuses the pull and the service reports the misleading
 * "A container's image could not be pulled due to inadequate network
 * configuration." work-request error, even though egress is healthy.
 *
 * Both resources are tenancy-scoped, so the apply identity needs to be a
 * tenancy administrator. Set create_ocir_pull_policy = false when the policy is
 * managed elsewhere (or when the OCIR repository is public).
 *
 * Neither costs anything, and CI keeps its state in the Actions cache, so a
 * lost state file would otherwise collide with the leftovers ("DynamicResource
 * Group with the same displayName already exists"). They are looked up by name
 * first and adopted when present, which also skips the propagation wait.
 */

locals {
  dynamic_group_name = "${local.name_prefix}-ci-dg"
  ocir_policy_name   = "${local.name_prefix}-ocir-pull"

  existing_dynamic_group_id = try(
    data.oci_identity_dynamic_groups.existing.dynamic_groups[0].id,
    null,
  )
  existing_ocir_policy_id = try(
    data.oci_identity_policies.existing.policies[0].id,
    null,
  )

  create_dynamic_group = var.create_ocir_pull_policy && local.existing_dynamic_group_id == null
  create_ocir_policy   = var.create_ocir_pull_policy && local.existing_ocir_policy_id == null

  dynamic_group_matching_rule = "ALL {resource.type='computecontainerinstance', resource.compartment.id = '${var.compartment_ocid}'}"

  # An adopted group scoped to another compartment authorizes nothing, and the
  # pull then fails as "inadequate network configuration".
  effective_matching_rule = try(
    data.oci_identity_dynamic_groups.existing.dynamic_groups[0].matching_rule,
    local.dynamic_group_matching_rule,
  )
}

data "oci_identity_dynamic_groups" "existing" {
  compartment_id = var.tenancy_ocid

  filter {
    name   = "name"
    values = ["${local.name_prefix}-ci-dg"]
  }
}

data "oci_identity_policies" "existing" {
  compartment_id = var.tenancy_ocid

  filter {
    name   = "name"
    values = ["${local.name_prefix}-ocir-pull"]
  }
}

resource "oci_identity_dynamic_group" "container_instances" {
  count = local.create_dynamic_group ? 1 : 0

  compartment_id = var.tenancy_ocid
  name           = local.dynamic_group_name
  description    = "Container Instances allowed to pull ${local.name_prefix} images from OCIR"
  matching_rule  = local.dynamic_group_matching_rule

  freeform_tags = local.common_tags
}

resource "oci_identity_policy" "ocir_pull" {
  count = local.create_ocir_policy ? 1 : 0

  # The statement names the dynamic group as a string, so nothing forces the
  # group to exist first.
  depends_on = [oci_identity_dynamic_group.container_instances]

  compartment_id = var.tenancy_ocid
  name           = local.ocir_policy_name
  description    = "Let ${local.name_prefix} Container Instances read OCIR repositories"

  statements = [
    "Allow dynamic-group ${local.dynamic_group_name} to read repos in tenancy",
  ]

  freeform_tags = local.common_tags
}

# OCI IAM is eventually consistent: a Container Instance created immediately
# after the policy can still be denied by OCIR, which fails the whole apply
# (the pull is not retried). Only needed when this run created the group or
# policy — an adopted one propagated long ago.
resource "time_sleep" "ocir_policy_propagation" {
  count = local.create_dynamic_group || local.create_ocir_policy ? 1 : 0

  create_duration = var.ocir_policy_propagation_wait

  triggers = {
    policy_id        = try(oci_identity_policy.ocir_pull[0].id, local.existing_ocir_policy_id, "adopted")
    dynamic_group_id = try(oci_identity_dynamic_group.container_instances[0].id, local.existing_dynamic_group_id, "adopted")
  }
}
