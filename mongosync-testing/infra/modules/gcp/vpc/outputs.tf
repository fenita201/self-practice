output "vpc" {
  value = {
    name      = google_compute_network.vpc.name
    id        = google_compute_network.vpc.id
    self_link = google_compute_network.vpc.self_link
  }
}

output "subnets" {
  value = {
    for subnet_key, subnet in google_compute_subnetwork.subnet :
    subnet_key => {
      name                     = subnet.name
      id                       = subnet.id
      self_link                = subnet.self_link
      ip_cidr_range            = subnet.ip_cidr_range
      region                   = subnet.region
      private_ip_google_access = subnet.private_ip_google_access
      secondary_ip_range = [
        for secondary in subnet.secondary_ip_range :
        {
          range_name    = secondary.range_name
          ip_cidr_range = secondary.ip_cidr_range
        }
      ]
    }
  }
}

output "nat_ip" {
  value = var.static_nat_ip_enabled ? google_compute_address.nat_ip[0].address : null
}
