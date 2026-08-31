/**
 * Monthly cost ceiling ($5 by default).
 *
 * OCI Budgets only *alert* — they do not destroy resources.
 * Enforcement (`terraform destroy` on the consumer stack) is done by
 * `deploy/oci_cost_guard.py`, scheduled via GitHub Actions.
 *
 * OCI allows a single budget per target compartment, so a budget left behind by
 * an earlier run (or created by hand) makes CreateBudget fail with
 * "400-LimitExceeded, 1 budgets already exist in target compartment". Budgets
 * are free, so an existing one is adopted rather than recreated.
 */

locals {
  existing_budget_id = try(
    [
      for budget in data.oci_budget_budgets.existing.budgets :
      budget.id if contains(coalesce(budget.targets, []), var.compartment_ocid)
    ][0],
    null,
  )

  create_budget = var.enable_cost_limit && local.existing_budget_id == null
  budget_id     = try(oci_budget_budget.css[0].id, local.existing_budget_id, null)
}

data "oci_budget_budgets" "existing" {
  compartment_id = var.tenancy_ocid
}

resource "oci_budget_budget" "css" {
  count = local.create_budget ? 1 : 0

  # Budgets are owned at the tenancy (root) compartment.
  compartment_id = var.tenancy_ocid
  amount         = var.cost_limit_usd
  reset_period   = "MONTHLY"
  target_type    = "COMPARTMENT"
  targets        = [var.compartment_ocid]

  display_name = "${local.name_prefix}-monthly-budget"
  description  = "Hard monthly spend ceiling for robot-scrape-products (${var.cost_limit_usd} USD)"

  freeform_tags = local.common_tags

  lifecycle {
    precondition {
      condition     = length(trimspace(var.cost_alert_email)) > 0
      error_message = "cost_alert_email must be set when enable_cost_limit is true (OCI Budget alert recipient)."
    }
  }
}

// Created alongside the budget only: an adopted budget already carries the
// rules from the run that created it.
resource "oci_budget_alert_rule" "actual_at_limit" {
  count = local.create_budget ? 1 : 0

  budget_id      = oci_budget_budget.css[0].id
  display_name   = "${local.name_prefix}-alert-100pct"
  description    = "Alert when actual spend reaches the ${var.cost_limit_usd} USD monthly ceiling"
  type           = "ACTUAL"
  threshold_type = "PERCENTAGE"
  threshold      = 100
  message        = "SkyDIIV robot-scrape-products: monthly cost limit (${var.cost_limit_usd} USD) reached. Cost guard will terraform-destroy the application infrastructure."
  recipients     = var.cost_alert_email

  freeform_tags = local.common_tags
}

resource "oci_budget_alert_rule" "actual_warning" {
  count = local.create_budget ? 1 : 0

  budget_id      = oci_budget_budget.css[0].id
  display_name   = "${local.name_prefix}-alert-80pct"
  description    = "Warning at 80% of the ${var.cost_limit_usd} USD monthly ceiling"
  type           = "ACTUAL"
  threshold_type = "PERCENTAGE"
  threshold      = 80
  message        = "SkyDIIV robot-scrape-products: 80% of monthly cost limit (${var.cost_limit_usd} USD) consumed."
  recipients     = var.cost_alert_email

  freeform_tags = local.common_tags
}
