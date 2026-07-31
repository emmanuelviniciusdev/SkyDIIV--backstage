/**
 * OCI Container Instance — ephemeral Sunday CRON robot.
 *
 * Pulls the robot image from OCIR, drains Cloudflare Queues (batch/concurrency
 * = 2) until empty, then self-deletes. Sunday 09:00 BRT `terraform destroy`
 * has absolute authority.
 */

locals {
  # us-ashburn-1.ocir.io/<namespace>/<repo>:<tag> → us-ashburn-1.ocir.io
  image_registry_host = split("/", split(":", var.container_image_url)[0])[0]

  # The pull secret is matched against the image URL by prefix. Oracle's
  # Container Instance examples use the bare registry host; some tenancies
  # also accept host/namespace — override with ocir_registry_endpoint if needed.
  #
  # For private OCIR, resource principal (iam.tf) is the real authorizer.
  # image_pull_secrets remain for external registries (Docker Hub, GHCR).
  ocir_registry_endpoint = coalesce(var.ocir_registry_endpoint, local.image_registry_host)

  # Only attach BASIC secrets for non-OCIR registries. Attaching them for OCIR
  # has caused pulls to fail even when the dynamic-group policy is correct.
  is_ocir_image        = endswith(local.image_registry_host, ".ocir.io") || strcontains(local.image_registry_host, ".ocir.")
  ocir_pull_configured = !local.is_ocir_image && var.ocir_username != "" && var.ocir_auth_token != ""
}

resource "oci_container_instances_container_instance" "robot" {
  # Without the OCIR read authorization in place first, the image pull is
  # rejected and OCI reports it as "inadequate network configuration".
  depends_on = [time_sleep.ocir_policy_propagation]

  compartment_id      = var.compartment_ocid
  availability_domain = local.availability_domain
  display_name        = local.name_prefix
  shape               = var.container_shape

  shape_config {
    ocpus         = var.container_ocpus
    memory_in_gbs = var.container_memory_in_gbs
  }

  vnics {
    subnet_id             = local.robot_subnet_id
    is_public_ip_assigned = !local.use_private_network
    display_name          = "${local.name_prefix}-vnic"
  }

  dynamic "image_pull_secrets" {
    for_each = local.ocir_pull_configured ? [1] : []
    content {
      registry_endpoint = local.ocir_registry_endpoint
      secret_type       = "BASIC"
      # The API rejects raw credentials: both fields must be base64.
      username = base64encode(var.ocir_username)
      password = base64encode(var.ocir_auth_token)
    }
  }

  containers {
    display_name = "robot-shopping-suggestions"
    image_url    = var.container_image_url

    # Resource principal must stay enabled so the instance can pull private OCIR
    # via the dynamic group policy in iam.tf.
    is_resource_principal_disabled = false

    environment_variables = merge(
      var.robot_env,
      {
        COMPUTE_PROVIDER     = "oci"
        ROBOT_DISPLAY_NAME   = local.name_prefix
        OCI_COMPARTMENT_OCID = var.compartment_ocid
        OCI_REGION           = var.region
        OCI_TENANCY_OCID     = var.tenancy_ocid
        OCI_USER_OCID        = var.user_ocid
        OCI_FINGERPRINT      = var.fingerprint
        CF_QUEUES_BATCH_SIZE = tostring(var.robot_batch_size)
        ROBOT_CONCURRENCY    = tostring(var.robot_concurrency)
        CAMOUFOX_HEADLESS    = "true"
      },
    )

    resource_config {
      vcpus_limit         = var.container_ocpus
      memory_limit_in_gbs = var.container_memory_in_gbs
    }
  }

  container_restart_policy             = "NEVER"
  graceful_shutdown_timeout_in_seconds = 120

  freeform_tags = merge(local.common_tags, {
    shape = var.container_shape
    mode  = "cron-batch-drain"
  })
}
