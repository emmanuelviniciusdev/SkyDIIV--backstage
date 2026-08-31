/**
 * Networking for the Container Instance, in one of two modes (var.network_mode):
 *
 *   public  — public subnet + Internet Gateway + ephemeral public IP.
 *             OCIR is reachable over the public internet. No NAT cost.
 *
 *   private — private subnet + NAT Gateway (internet) + Service Gateway
 *             (Oracle Services Network / OCIR). NAT is billed hourly.
 *
 * OCI rejects a route table that mixes an Internet Gateway default route with a
 * Service Gateway "All Services" route, so the two modes are mutually exclusive.
 *
 * IPv4 only: the scraper, Cloudflare Queues, Postgres and the OCI API are all
 * reached over IPv4, so a dual-stack subnet would only add ::/0 blackhole risk.
 *
 * Note: an image-pull failure is *not* evidence of a networking problem here.
 * OCI reports OCIR authorization failures as "A container's image could not be
 * pulled due to inadequate network configuration" too — see iam.tf.
 */

locals {
  use_private_network = var.network_mode == "private"
}

data "oci_core_services" "all" {
  filter {
    name   = "name"
    values = ["All .* Services In Oracle Services Network"]
    regex  = true
  }
}

resource "oci_core_vcn" "this" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-vcn"
  cidr_blocks    = [var.vcn_cidr]
  dns_label      = local.dns_label

  freeform_tags = local.common_tags
}

# ── public mode ───────────────────────────────────────────────────────────────

resource "oci_core_internet_gateway" "this" {
  count = local.use_private_network ? 0 : 1

  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${local.name_prefix}-igw"
  enabled        = true

  freeform_tags = local.common_tags
}

resource "oci_core_route_table" "public" {
  count = local.use_private_network ? 0 : 1

  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${local.name_prefix}-public-rt"

  route_rules {
    description       = "Default IPv4 route to Internet Gateway"
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.this[0].id
  }

  freeform_tags = local.common_tags
}

resource "oci_core_security_list" "public" {
  count = local.use_private_network ? 0 : 1

  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${local.name_prefix}-public-sl"

  # No ingress rules on purpose: the instance holds a public IP but exposes no
  # listener. Egress is stateful, so scrape responses still come back.

  egress_security_rules {
    description = "Allow all IPv4 egress"
    protocol    = "all"
    destination = "0.0.0.0/0"
  }

  freeform_tags = local.common_tags
}

resource "oci_core_subnet" "public" {
  count = local.use_private_network ? 0 : 1

  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.this.id
  display_name               = "${local.name_prefix}-public"
  dns_label                  = "public"
  cidr_block                 = var.subnet_cidr
  route_table_id             = oci_core_route_table.public[0].id
  security_list_ids          = [oci_core_security_list.public[0].id]
  dhcp_options_id            = oci_core_vcn.this.default_dhcp_options_id
  prohibit_public_ip_on_vnic = false

  freeform_tags = local.common_tags
}

# ── private mode ──────────────────────────────────────────────────────────────

resource "oci_core_nat_gateway" "this" {
  count = local.use_private_network ? 1 : 0

  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${local.name_prefix}-nat"
  block_traffic  = false

  freeform_tags = local.common_tags
}

resource "oci_core_service_gateway" "this" {
  count = local.use_private_network ? 1 : 0

  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${local.name_prefix}-sgw"

  services {
    service_id = data.oci_core_services.all.services[0].id
  }

  freeform_tags = local.common_tags
}

resource "oci_core_route_table" "private" {
  count = local.use_private_network ? 1 : 0

  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${local.name_prefix}-private-rt"

  route_rules {
    description       = "Default IPv4 route to NAT Gateway"
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_nat_gateway.this[0].id
  }

  route_rules {
    description       = "Oracle Services Network (OCIR) via Service Gateway"
    destination       = data.oci_core_services.all.services[0].cidr_block
    destination_type  = "SERVICE_CIDR_BLOCK"
    network_entity_id = oci_core_service_gateway.this[0].id
  }

  freeform_tags = local.common_tags
}

resource "oci_core_security_list" "private" {
  count = local.use_private_network ? 1 : 0

  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${local.name_prefix}-private-sl"

  egress_security_rules {
    description = "Allow all IPv4 egress (via NAT)"
    protocol    = "all"
    destination = "0.0.0.0/0"
  }

  egress_security_rules {
    description      = "Allow egress to Oracle Services Network (OCIR)"
    protocol         = "all"
    destination      = data.oci_core_services.all.services[0].cidr_block
    destination_type = "SERVICE_CIDR_BLOCK"
  }

  freeform_tags = local.common_tags
}

resource "oci_core_subnet" "private" {
  count = local.use_private_network ? 1 : 0

  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.this.id
  display_name               = "${local.name_prefix}-private"
  dns_label                  = "private"
  cidr_block                 = var.private_subnet_cidr
  route_table_id             = oci_core_route_table.private[0].id
  security_list_ids          = [oci_core_security_list.private[0].id]
  dhcp_options_id            = oci_core_vcn.this.default_dhcp_options_id
  prohibit_public_ip_on_vnic = true

  freeform_tags = local.common_tags
}

locals {
  robot_subnet_id = local.use_private_network ? oci_core_subnet.private[0].id : oci_core_subnet.public[0].id
}
