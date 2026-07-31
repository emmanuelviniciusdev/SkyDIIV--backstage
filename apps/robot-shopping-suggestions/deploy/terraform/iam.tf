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
 */

resource "oci_identity_dynamic_group" "container_instances" {
  count = var.create_ocir_pull_policy ? 1 : 0

  compartment_id = var.tenancy_ocid
  name           = "${local.name_prefix}-ci-dg"
  description    = "Container Instances allowed to pull ${local.name_prefix} images from OCIR"
  matching_rule  = "ALL {resource.type='computecontainerinstance', resource.compartment.id = '${var.compartment_ocid}'}"

  freeform_tags = local.common_tags
}

resource "oci_identity_policy" "ocir_pull" {
  count = var.create_ocir_pull_policy ? 1 : 0

  compartment_id = var.tenancy_ocid
  name           = "${local.name_prefix}-ocir-pull"
  description    = "Let ${local.name_prefix} Container Instances read OCIR repositories"

  statements = [
    "Allow dynamic-group ${oci_identity_dynamic_group.container_instances[0].name} to read repos in tenancy",
  ]

  freeform_tags = local.common_tags
}

# OCI IAM is eventually consistent: a Container Instance created immediately
# after the policy can still be denied by OCIR, which fails the whole apply
# (the pull is not retried). The stack is torn down and rebuilt weekly, so this
# wait is paid on every rebuild — keep it comfortably above observed
# propagation time rather than trimming it.
resource "time_sleep" "ocir_policy_propagation" {
  count = var.create_ocir_pull_policy ? 1 : 0

  create_duration = var.ocir_policy_propagation_wait

  triggers = {
    policy_id        = oci_identity_policy.ocir_pull[0].id
    dynamic_group_id = oci_identity_dynamic_group.container_instances[0].id
  }
}
