output "ingress_rules" {
  value = google_compute_firewall.allow_ingresses
}

output "egress_rules" {
  value = google_compute_firewall.allow_egresses
}