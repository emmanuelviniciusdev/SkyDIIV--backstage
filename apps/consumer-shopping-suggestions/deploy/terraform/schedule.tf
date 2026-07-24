/**
 * Weekly start/stop window for cost control.
 *
 * Default (America/Sao_Paulo):
 *   START Thursday 11:00 → cron UTC `0 14 * * 4`
 *   STOP  Thursday 12:00 → cron UTC `0 15 * * 4`
 *
 * Disabled when `enable_weekly_schedule = false` (test / staging deploys).
 *
 * Requires an Identity policy allowing Resource Scheduler to manage instances
 * in the compartment (see deploy/README.md).
 */

resource "oci_resource_scheduler_schedule" "start_thursday" {
  count = var.enable_weekly_schedule ? 1 : 0

  compartment_id     = var.compartment_ocid
  action             = "START_RESOURCE"
  recurrence_type    = "CRON"
  recurrence_details = var.schedule_start_cron_utc
  display_name       = "${local.name_prefix}-start-thursday"
  description        = "Start consumer-shopping-suggestions VM (Thursday window)"

  resources {
    id = oci_core_instance.consumer.id
  }

  freeform_tags = local.common_tags
}

resource "oci_resource_scheduler_schedule" "stop_thursday" {
  count = var.enable_weekly_schedule ? 1 : 0

  compartment_id     = var.compartment_ocid
  action             = "STOP_RESOURCE"
  recurrence_type    = "CRON"
  recurrence_details = var.schedule_stop_cron_utc
  display_name       = "${local.name_prefix}-stop-thursday"
  description        = "Stop consumer-shopping-suggestions VM (Thursday window)"

  resources {
    id = oci_core_instance.consumer.id
  }

  freeform_tags = local.common_tags
}

/**
 * Lets Resource Scheduler start/stop compute in this compartment.
 * Set create_resource_scheduler_policy = false if a tenancy-level policy already exists.
 */
resource "oci_identity_policy" "resource_scheduler" {
  count = var.enable_weekly_schedule && var.create_resource_scheduler_policy ? 1 : 0

  compartment_id = var.tenancy_ocid
  name           = "${local.name_prefix}-resource-scheduler"
  description    = "Allow OCI Resource Scheduler to start/stop the shopping-suggestions VM"

  statements = [
    "Allow any-user to manage instance-family in compartment id ${var.compartment_ocid} where all { request.principal.type = 'resourcescheduler' }",
  ]
}
