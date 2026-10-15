resource "google_compute_network" "vpc" {
  name                    = "${var.env}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
  project                 = var.project
}

resource "google_compute_subnetwork" "subnet" {
  for_each                 = local.subnets
  name                     = each.value.name
  ip_cidr_range            = each.value.cidr_blocks[0]
  region                   = each.value.region
  network                  = google_compute_network.vpc.self_link
  private_ip_google_access = each.value.private_ip_google_access
  project                  = var.project

  dynamic "secondary_ip_range" {
    for_each = length(each.value.cidr_blocks) > 1 ? slice(each.value.cidr_blocks, 1, length(each.value.cidr_blocks)) : []
    content {
      range_name    = "${each.value.name}-secondary-${index(each.value.cidr_blocks, secondary_ip_range.value)}"
      ip_cidr_range = secondary_ip_range.value
    }
  }
}

resource "google_compute_router" "default_router" {
  name    = "${var.env}-default-router"
  network = google_compute_network.vpc.self_link
  region  = var.region
  project = var.project
}

resource "google_compute_address" "nat_ip" {
  count   = var.static_nat_ip_enabled ? 1 : 0
  name    = "${var.env}-nat-ip"
  region  = var.region
  project = var.project
}

resource "google_compute_router_nat" "internet_gateway" {
  name                               = "${var.env}-internet-gateway"
  router                             = google_compute_router.default_router.name
  region                             = var.region
  project                            = var.project
  nat_ip_allocate_option             = var.static_nat_ip_enabled ? "MANUAL_ONLY" : "AUTO_ONLY"
  nat_ips                            = var.static_nat_ip_enabled ? [google_compute_address.nat_ip[0].self_link] : []
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
  auto_network_tier                  = "PREMIUM"
}
