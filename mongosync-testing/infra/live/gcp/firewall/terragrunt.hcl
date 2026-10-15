# Firewall cho lab-vpc. Danh sach rule: block `firewall.rules` trong ../values.yaml.
# File nay chi gan network va doi `source_subnets` (ten subnet) thanh CIDR lay tu unit vpc.
include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../modules/gcp/firewall"
}

dependency "vpc" {
  config_path                             = "../vpc"
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
  mock_outputs = {
    vpc = { self_link = "https://www.googleapis.com/compute/v1/projects/mock/global/networks/mock-vpc" }
    subnets = {
      mongo = { ip_cidr_range = "10.20.0.0/24" }
      sync  = { ip_cidr_range = "10.21.0.0/24" }
    }
  }
}

locals {
  env   = include.root.locals.lab.env
  rules = include.root.locals.values.rules
}

inputs = {
  firewall_rules = {
    ingresses = [for r in local.rules : {
      name     = "${local.env}-${r.name}"
      network  = dependency.vpc.outputs.vpc.self_link
      priority = try(r.priority, 1000)
      source_ranges = concat(
        try(r.source_ranges, []),
        [for s in try(r.source_subnets, []) : dependency.vpc.outputs.subnets[s].ip_cidr_range],
      )
      target_tags = r.target_tags
      protocol    = r.protocol
      ports       = r.ports
      description = r.description
    }]
    egresses = []
  }
}
