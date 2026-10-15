# Atlas project cho dich M10 (huong B): network container + VPC peering 2 chieu voi lab-vpc,
# whitelist subnet GCP (`access_subnet_name`) vi Atlas van kiem tra access list khi di qua peering.
# Cau hinh: block `m10-project` trong ../values.yaml; org_id lay tu ATLAS_ORG_ID (infra/.env).
include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../modules/atlas/project"
}

dependency "vpc" {
  config_path                             = "../../gcp/vpc"
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
  mock_outputs = {
    vpc = {
      name      = "lab-vpc"
      self_link = "https://www.googleapis.com/compute/v1/projects/mock/global/networks/lab-vpc"
    }
    subnets = {
      mongo = { ip_cidr_range = "10.20.0.0/24" }
      sync  = { ip_cidr_range = "10.21.0.0/24" }
    }
  }
}

locals {
  access_subnet = include.root.locals.values.access_subnet_name
}

inputs = {
  org_id = get_env("ATLAS_ORG_ID")

  peering_info = [{
    project_id        = get_env("GCP_PROJECT_ID")
    network_name      = dependency.vpc.outputs.vpc.name
    network_self_link = dependency.vpc.outputs.vpc.self_link
  }]

  project_ip_access_list = [{
    cidr_block = dependency.vpc.outputs.subnets[local.access_subnet].ip_cidr_range
    comment    = "GCP subnet ${local.access_subnet} via VPC peering"
  }]
}
