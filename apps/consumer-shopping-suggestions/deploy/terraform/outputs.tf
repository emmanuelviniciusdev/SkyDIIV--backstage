output "instance_ocid" {
  description = "OCID of the compute instance"
  value       = oci_core_instance.consumer.id
}

output "instance_public_ip" {
  description = "Public IPv4 address used for SSH deploy"
  value       = oci_core_instance.consumer.public_ip
}

output "ssh_user" {
  description = "OS user for SSH (ubuntu or opc)"
  value       = local.ssh_user
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
  description = "Public subnet OCID"
  value       = oci_core_subnet.public.id
}

output "vnic_id" {
  description = "Primary VNIC OCID"
  value       = local.vnic_id
}

output "ipv6_addresses" {
  description = "Public IPv6 addresses assigned for egress rotation"
  value       = local.ipv6_addresses
}

output "proxy_urls" {
  description = "Local SOCKS proxy URLs the application should use (PROXY_URLS)"
  value       = local.proxy_urls
}

output "proxy_base_port" {
  description = "Base port for microsocks listeners"
  value       = var.proxy_base_port
}

output "ipv6_pool_file" {
  description = "Newline-separated IPv6 list written for the VM deploy script"
  value       = join("\n", local.ipv6_addresses)
}

output "instance_shape" {
  description = "Compute shape"
  value       = var.instance_shape
}

output "name_prefix" {
  description = "OCI display-name prefix (production VM name is exact)"
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
