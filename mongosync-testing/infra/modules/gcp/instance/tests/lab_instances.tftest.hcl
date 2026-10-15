# Chay: cd infra/modules/gcp/instance && terraform init && terraform test
mock_provider "google" {}

variables {
  project        = "mock-project"
  region         = "us-central1"
  zone           = "a"
  env            = "lab"
  platform       = "src"
  machine_type   = "e2-small"
  os_image       = "ubuntu-os-cloud/ubuntu-2204-lts"
  tags           = ["allow-ssh", "allow-mongodb"]
  subnet         = "projects/mock-project/regions/us-central1/subnetworks/mongo"
  ssh_public_key = "ssh-ed25519 validation-only"
  num_instances  = 3
  internal_ips   = ["10.20.0.11", "10.20.0.12", "10.20.0.13"]
}

run "three_private_vms_with_fixed_ips" {
  command = plan
  assert {
    condition     = length(google_compute_instance.main_instance) == 3 && length(google_compute_address.external_ip) == 0 && google_compute_address.internal_ip[2].address == "10.20.0.13"
    error_message = "Expected three VMs with fixed internal IPs and no public IPs."
  }
  assert {
    condition     = google_compute_instance.main_instance[0].name == "lab-src-1" && google_compute_instance.main_instance[0].zone == "us-central1-a"
    error_message = "VM name/zone convention changed."
  }
}

run "reject_wrong_number_of_internal_ips" {
  command = plan
  variables {
    internal_ips = ["10.20.0.11"]
  }
  expect_failures = [var.internal_ips]
}
