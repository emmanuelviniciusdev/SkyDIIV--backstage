/**
 * Always Free–eligible networking: VCN + public subnet with IPv4 and IPv6.
 */

resource "oci_core_vcn" "this" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-vcn"
  cidr_blocks    = [var.vcn_cidr]
  is_ipv6enabled = true
  dns_label      = local.dns_label

  freeform_tags = local.common_tags
}

resource "oci_core_internet_gateway" "this" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${local.name_prefix}-igw"
  enabled        = true

  freeform_tags = local.common_tags
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${local.name_prefix}-public-rt"

  route_rules {
    description       = "Default IPv4 route to Internet Gateway"
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.this.id
  }

  route_rules {
    description       = "Default IPv6 route to Internet Gateway"
    destination       = "::/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.this.id
  }

  freeform_tags = local.common_tags
}

resource "oci_core_security_list" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${local.name_prefix}-public-sl"

  # IPv4 egress — all
  egress_security_rules {
    description = "Allow all IPv4 egress"
    protocol    = "all"
    destination = "0.0.0.0/0"
  }

  # IPv6 egress — all
  egress_security_rules {
    description      = "Allow all IPv6 egress"
    protocol         = "all"
    destination      = "::/0"
    destination_type = "CIDR_BLOCK"
  }

  # SSH IPv4
  ingress_security_rules {
    description = "SSH over IPv4"
    protocol    = "6"
    source      = var.ssh_ingress_cidr

    tcp_options {
      min = 22
      max = 22
    }
  }

  # SSH IPv6
  ingress_security_rules {
    description = "SSH over IPv6"
    protocol    = "6"
    source      = "::/0"
    source_type = "CIDR_BLOCK"

    tcp_options {
      min = 22
      max = 22
    }
  }

  freeform_tags = local.common_tags
}

resource "oci_core_subnet" "public" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.this.id
  display_name               = "${local.name_prefix}-public"
  dns_label                  = "public"
  cidr_block                 = var.subnet_cidr
  ipv6cidr_block             = cidrsubnet(oci_core_vcn.this.ipv6cidr_blocks[0], 8, 0)
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.public.id]
  dhcp_options_id            = oci_core_vcn.this.default_dhcp_options_id
  prohibit_public_ip_on_vnic = false

  freeform_tags = local.common_tags
}
