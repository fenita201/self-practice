# File goc ma moi unit `include`: backend state + input chung + input rieng tu values.yaml.
locals {
  lab = yamldecode(file("${get_parent_terragrunt_dir()}/lab.yaml"))

  # Unit infra/live/<nhom>/<unit> doc block <unit> trong infra/live/<nhom>/values.yaml.
  # (get_terragrunt_dir() la thu muc cua unit dang chay, khong phai cua root.hcl)
  unit        = basename(get_terragrunt_dir())
  values_file = "${dirname(get_terragrunt_dir())}/values.yaml"
  values      = try(yamldecode(file(local.values_file))[local.unit], {})
}

# State local trong infra/live/.state/<unit>/terraform.tfstate (da .gitignore).
# State chua password/private key o dang plain text => khong commit, khong gui cho ai.
generate "backend" {
  path      = "backend.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOT
terraform {
  backend "local" {
    path = "${get_parent_terragrunt_dir()}/.state/${path_relative_to_include()}/terraform.tfstate"
  }
}
EOT
}

# Input cua unit = gia tri chung + block trong values.yaml + phan `inputs` trong terragrunt.hcl
# cua unit (cai sau ghi de cai truoc). Khoa khong phai variable cua module se bi bo qua.
inputs = merge(
  {
    env          = local.lab.env
    region       = local.lab.region
    zone         = local.lab.zone
    atlas_region = local.lab.atlas_region
    project      = get_env("GCP_PROJECT_ID")
  },
  local.values,
)
