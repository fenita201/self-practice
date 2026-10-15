# VM chay mongosync + tools - noi DUY NHAT can thay ca source lan destination.
# Cau hinh (so VM, IP, machine type...): block `sync-vm` trong ../values.yaml
include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../modules/gcp/instance"
}

dependency "vpc" {
  config_path                             = "../vpc"
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
  mock_outputs = {
    subnets = {
      mongo = { self_link = "https://www.googleapis.com/compute/v1/projects/mock/regions/us-central1/subnetworks/mock-mongo" }
      sync  = { self_link = "https://www.googleapis.com/compute/v1/projects/mock/regions/us-central1/subnetworks/mock-sync" }
    }
  }
}

dependency "key-pair" {
  config_path                             = "../key-pair"
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
  mock_outputs                            = { ssh_public_key = "ssh-ed25519 mock-validation-only" }
}

# VM chi nen tao sau khi firewall da co (de SSH qua IAP duoc ngay).
dependencies {
  paths = ["../firewall"]
}

inputs = {
  subnet         = dependency.vpc.outputs.subnets[include.root.locals.values.subnet_name].self_link
  ssh_public_key = dependency.key-pair.outputs.ssh_public_key
}
