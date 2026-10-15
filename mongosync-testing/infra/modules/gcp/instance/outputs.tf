output "instances" {
  value = {
    for idx in range(var.num_instances) : google_compute_instance.main_instance[idx].name => {
      name        = google_compute_instance.main_instance[idx].name
      zone        = google_compute_instance.main_instance[idx].zone
      internal_ip = google_compute_address.internal_ip[idx].address
      external_ip = var.enable_external_ip ? google_compute_address.external_ip[idx].address : null
    }
  }
}
