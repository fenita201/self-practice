# Sinh SSH key va gan public key vao moi VM (user ubuntu).
# gcloud compute ssh van dung key rieng cua gcloud; key nay de dung voi ssh/scp thuong qua IAP.
# Cau hinh: block `key-pair` trong ../values.yaml
include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "../../../modules/gcp/key-pair"
}
