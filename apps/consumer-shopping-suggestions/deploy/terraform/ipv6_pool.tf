/**
 * Extra public IPv6 addresses on the instance VNIC for egress rotation.
 * The application never sees these — deploy scripts bind each to a local SOCKS proxy.
 */

resource "oci_core_ipv6" "egress_pool" {
  count = var.ipv6_count

  vnic_id = local.vnic_id

  freeform_tags = merge(local.common_tags, {
    purpose = "egress-rotation"
    index   = tostring(count.index)
  })
}

locals {
  ipv6_addresses = [for ip in oci_core_ipv6.egress_pool : ip.ip_address]
  proxy_urls = [
    for i in range(var.ipv6_count) :
    "socks5://127.0.0.1:${var.proxy_base_port + i}"
  ]
}
