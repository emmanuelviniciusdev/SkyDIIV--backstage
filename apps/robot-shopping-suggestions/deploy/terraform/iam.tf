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
 * When a previous run left the group/policy behind (lost state), they are
 * imported into this stack and their matching rule / statements are reconciled.
 * The OCI list API omits matching_rule, so "adopt by name and skip create"
 * cannot verify the rule — import + manage is the reliable path.
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

  dynamic_group_matching_rule = "ALL {resource.type='computecontainerinstance', resource.compartment.id = '${var.compartment_ocid}'}"
}

data "oci_identity_dynamic_groups" "existing" {
  compartment_id = var.tenancy_ocid

  filter {
    name   = "name"
    values = [local.dynamic_group_name]
  }
}

data "oci_identity_policies" "existing" {
  compartment_id = var.tenancy_ocid

  filter {
    name   = "name"
    values = [local.ocir_policy_name]
  }
}

# Bring orphans into state when remote state was lost (Actions cache / first
# remote-backend run). No-op once the resource is already managed.
import {
  for_each = (
    var.create_ocir_pull_policy && local.existing_dynamic_group_id != null
    ? { "0" = local.existing_dynamic_group_id }
    : {}
  )
  to = oci_identity_dynamic_group.container_instances[tonumber(each.key)]
  id = each.value
}

import {
  for_each = (
    var.create_ocir_pull_policy && local.existing_ocir_policy_id != null
    ? { "0" = local.existing_ocir_policy_id }
    : {}
  )
  to = oci_identity_policy.ocir_pull[tonumber(each.key)]
  id = each.value
}

resource "oci_identity_dynamic_group" "container_instances" {
  count = var.create_ocir_pull_policy ? 1 : 0

  compartment_id = var.tenancy_ocid
  name           = local.dynamic_group_name
  description    = "Container Instances allowed to pull ${local.name_prefix} images from OCIR"
  matching_rule  = local.dynamic_group_matching_rule

  freeform_tags = local.common_tags
}

resource "oci_identity_policy" "ocir_pull" {
  count = var.create_ocir_pull_policy ? 1 : 0

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
# (the pull is not retried). Triggers replace this wait when the group or
# policy changes so a corrected matching rule has time to propagate.
resource "time_sleep" "ocir_policy_propagation" {
  count = var.create_ocir_pull_policy ? 1 : 0

  create_duration = var.ocir_policy_propagation_wait

  triggers = {
    policy_id        = oci_identity_policy.ocir_pull[0].id
    dynamic_group_id = oci_identity_dynamic_group.container_instances[0].id
    matching_rule    = oci_identity_dynamic_group.container_instances[0].matching_rule
  }
}
