locals {
  default_labels = {
    env        = var.env
    managed_by = "terraform"
  }
  applied_labels = merge(var.labels, local.default_labels)

  subnets = merge(flatten([
    for name, cidr_blocks in var.subnets : {
      "${name}" = {
        name                     = "${var.env}-${name}"
        cidr_blocks              = cidr_blocks
        region                   = var.region
        private_ip_google_access = true
      }
    }
  ])...)
}