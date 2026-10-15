# Dung GCP project co san (tao bang gcloud), chi bat cac API can cho lab.
# Cau hinh: block `project` trong ../values.yaml
include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "../../../modules/gcp/project"
}
