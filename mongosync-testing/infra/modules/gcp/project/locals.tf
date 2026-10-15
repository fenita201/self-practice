locals {
  default_labels = {
    env        = var.env
    managed_by = "terraform"
  }
  applied_labels = merge(var.labels, local.default_labels)
}