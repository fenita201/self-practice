# Atlas project cho cluster Free M0 (huong C). M0 khong ho tro VPC peering
# => whitelist IP tinh cua Cloud NAT (lay tu unit gcp/vpc) + MY_PUBLIC_IP (infra/.env) neu co.
# Cau hinh: block `m0-project` trong ../values.yaml; org_id lay tu ATLAS_ORG_ID.
include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "../../../modules/atlas/project"
}

dependency "vpc" {
  config_path                             = "../../gcp/vpc"
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
  mock_outputs                            = { nat_ip = "203.0.113.10" }
}

locals {
  my_ip = get_env("MY_PUBLIC_IP", "")
}

inputs = {
  org_id = get_env("ATLAS_ORG_ID")

  project_ip_access_list = concat(
    [{ cidr_block = "${dependency.vpc.outputs.nat_ip}/32", comment = "GCP lab Cloud NAT" }],
    local.my_ip == "" ? [] : [{ cidr_block = "${local.my_ip}/32", comment = "My machine" }],
  )
}
