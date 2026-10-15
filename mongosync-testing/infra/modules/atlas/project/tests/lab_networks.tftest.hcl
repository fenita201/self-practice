# kiểm tra M0 không tạo container/peering và M10 tạo đủ hai phía.
mock_provider "mongodbatlas" {}
mock_provider "google" {}
mock_provider "random" {}


variables {
  project      = "mock-project"
  region       = "us-central1"
  atlas_region = "CENTRAL_US"
  org_id       = "000000000000000000000000"
  project_name = "lab-test"
}

run "m0_empty_whitelist_creates_no_network_resources" {
  command = plan
  variables {
    enable_peering = false
  }
  assert {
    condition     = length(mongodbatlas_network_container.subnet) == 0 && length(mongodbatlas_network_peering.to_gcp) == 0 && length(google_compute_network_peering.from_gcp) == 0 && length(mongodbatlas_project_ip_access_list.ip_access_list) == 0
    error_message = "M0 with no NAT IP must create neither peers nor any default open whitelist."
  }
  assert {
    condition     = output.network_container == null
    error_message = "M0 network_container output must be null."
  }
}

run "m0_only_adds_entered_public_nat_ip" {
  command = plan
  variables {
    enable_peering         = false
    project_ip_access_list = [{ cidr_block = "203.0.113.10/32", comment = "test-only NAT IP" }]
  }
  assert {
    condition     = length(mongodbatlas_project_ip_access_list.ip_access_list) == 1 && mongodbatlas_project_ip_access_list.ip_access_list["203.0.113.10/32"].cidr_block == "203.0.113.10/32" && length(mongodbatlas_network_container.subnet) == 0
    error_message = "Adding NAT /32 must only add that whitelist entry, not peering."
  }
}

run "m10_creates_peering_both_sides" {
  command = plan
  variables {
    enable_peering   = true
    atlas_cidr_block = "10.30.0.0/21"
    peering_info = [{
      project_id        = "mock-project"
      network_name      = "lab-vpc"
      network_self_link = "https://www.googleapis.com/compute/v1/projects/mock-project/global/networks/lab-vpc"
    }]
  }
  assert {
    condition     = length(mongodbatlas_network_container.subnet) == 1 && length(mongodbatlas_network_peering.to_gcp) == 1 && length(google_compute_network_peering.from_gcp) == 1
    error_message = "M10 must create a container and both Atlas/GCP peering resources."
  }
}
