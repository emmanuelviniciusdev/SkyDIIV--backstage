/**
 * Monthly cost ceiling ($5 by default).
 *
 * OCI Budgets only *alert* — they do not destroy resources.
 * Enforcement (`terraform destroy` on the consumer stack) is done by
 * `deploy/oci_cost_guard.py`, scheduled via GitHub Actions.
 */

resource "oci_budget_budget" "css" {
  count = var.enable_cost_limit ? 1 : 0

  # Budgets are owned at the tenancy (root) compartment.
  compartment_id = var.tenancy_ocid
  amount         = var.cost_limit_usd
  reset_period   = "MONTHLY"
  target_type    = "COMPARTMENT"
  targets        = [var.compartment_ocid]

  display_name = "${local.name_prefix}-monthly-budget"
  description  = "Hard monthly spend ceiling for consumer-shopping-suggestions (${var.cost_limit_usd} USD)"

  freeform_tags = local.common_tags

  lifecycle {
    precondition {
      condition     = length(trimspace(var.cost_alert_email)) > 0
      error_message = "cost_alert_email must be set when enable_cost_limit is true (OCI Budget alert recipient)."
    }
  }
}

resource "oci_budget_alert_rule" "actual_at_limit" {
  count = var.enable_cost_limit ? 1 : 0

  budget_id      = oci_budget_budget.css[0].id
  display_name   = "${local.name_prefix}-alert-100pct"
  description    = "Alert when actual spend reaches the ${var.cost_limit_usd} USD monthly ceiling"
  type           = "ACTUAL"
  threshold_type = "PERCENTAGE"
  threshold      = 100
  message        = "SkyDIIV consumer-shopping-suggestions: monthly cost limit (${var.cost_limit_usd} USD) reached. Cost guard will terraform-destroy the application infrastructure."
  recipients     = var.cost_alert_email

  freeform_tags = local.common_tags
}

resource "oci_budget_alert_rule" "actual_warning" {
  count = var.enable_cost_limit ? 1 : 0

  budget_id      = oci_budget_budget.css[0].id
  display_name   = "${local.name_prefix}-alert-80pct"
  description    = "Warning at 80% of the ${var.cost_limit_usd} USD monthly ceiling"
  type           = "ACTUAL"
  threshold_type = "PERCENTAGE"
  threshold      = 80
  message        = "SkyDIIV consumer-shopping-suggestions: 80% of monthly cost limit (${var.cost_limit_usd} USD) consumed."
  recipients     = var.cost_alert_email

  freeform_tags = local.common_tags
}
