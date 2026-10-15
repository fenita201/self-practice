# VPC rieng cho lab + subnet + Cloud NAT (VM khong co public IP van ra Internet duoc).
# Cau hinh: block `vpc` trong ../values.yaml
include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "../../../modules/gcp/vpc"
}

dependencies {
  paths = ["../project"]
}
