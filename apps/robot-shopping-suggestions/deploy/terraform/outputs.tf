output "container_instance_ocid" {
  description = "OCID of the Container Instance"
  value       = oci_container_instances_container_instance.robot.id
}

output "container_instance_state" {
  description = "Lifecycle state of the Container Instance"
  value       = oci_container_instances_container_instance.robot.state
}

output "availability_domain" {
  description = "Availability domain where the instance was placed"
  value       = local.availability_domain
}

output "vcn_id" {
  description = "VCN OCID"
  value       = oci_core_vcn.this.id
}

output "subnet_id" {
  description = "Subnet OCID hosting the Container Instance"
  value       = local.robot_subnet_id
}

output "network_mode" {
  description = "Network mode in effect (public|private)"
  value       = var.network_mode
}

output "container_shape" {
  description = "Container Instance shape"
  value       = var.container_shape
}

output "container_image_url" {
  description = "OCIR image URL"
  value       = var.container_image_url
}

output "ocir_registry_endpoint" {
  description = "Registry endpoint used for image_pull_secrets"
  value       = local.ocir_registry_endpoint
}

output "ocir_pull_policy" {
  description = "Name of the policy authorizing OCIR pulls (null when not managed here)"
  value       = try(oci_identity_policy.ocir_pull[0].name, null)
}

output "name_prefix" {
  description = "OCI display-name prefix"
  value       = local.name_prefix
}

output "enable_cost_limit" {
  description = "Whether the monthly OCI Budget + cost guard ceiling is enabled"
  value       = var.enable_cost_limit
}

output "cost_limit_usd" {
  description = "Monthly spend ceiling in USD"
  value       = var.cost_limit_usd
}

output "budget_id" {
  description = "OCID of the monthly budget (null when disabled)"
  value       = try(oci_budget_budget.css[0].id, null)
}

# Compatibility aliases used by older scripts / cost guard fallbacks
output "instance_ocid" {
  description = "Alias of container_instance_ocid (cost-guard / scripts)"
  value       = oci_container_instances_container_instance.robot.id
}
