# Cluster Free M0 + user `lab_app` cho generator/connector/compare.
# LUU Y: mongosync KHONG ho tro M0/Flex (shared tier). Dung de luyen Terraform Atlas va migrate offline.
# Cau hinh: block `m0-cluster` trong ../values.yaml
include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "../../../modules/atlas/cluster"
}

dependency "project" {
  config_path                             = "../m0-project"
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
  mock_outputs                            = { project = { id = "000000000000000000000000" } }
}

inputs = {
  project_id = dependency.project.outputs.project.id
}
