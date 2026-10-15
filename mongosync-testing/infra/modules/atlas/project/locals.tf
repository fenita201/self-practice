locals {
  default_tags = {
    env        = var.env
    managed_by = "terraform"
  }
  applied_tags = merge(var.tags, local.default_tags)

  project_users_by_username = {
    for user in var.project_users : user.username => user
  }
}
