resource "google_compute_firewall" "allow_ingresses" {
  for_each      = { for rule in var.firewall_rules.ingresses : rule.name => rule }
  name          = each.value.name
  network       = each.value.network
  direction     = "INGRESS"
  priority      = each.value.priority
  project       = var.project
  source_ranges = each.value.source_ranges
  target_tags   = each.value.target_tags
  description   = each.value.description
  allow {
    protocol = each.value.protocol
    ports    = each.value.ports
  }
}

resource "google_compute_firewall" "allow_egresses" {
  for_each           = { for rule in var.firewall_rules.egresses : rule.name => rule }
  name               = each.value.name
  network            = each.value.network
  direction          = "EGRESS"
  priority           = each.value.priority
  project            = var.project
  destination_ranges = each.value.destination_ranges
  target_tags        = each.value.target_tags
  description        = each.value.description
  allow {
    protocol = each.value.protocol
    ports    = each.value.ports
  }
}