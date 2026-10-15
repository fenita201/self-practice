# Cluster dich M10 + user `mongosync` (role mongosyncDestination = atlasAdmin + BYPASS_USER_WRITE_BLOCK).
# M10 tinh phi theo gio ngay khi tao => destroy ngay khi xong lab.
# Cau hinh: block `m10-cluster` trong ../values.yaml
include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "../../../modules/atlas/cluster"
}

dependency "project" {
  config_path                             = "../m10-project"
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
  mock_outputs                            = { project = { id = "000000000000000000000010" } }
}

inputs = {
  project_id = dependency.project.outputs.project.id
}
