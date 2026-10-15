locals {
  # M0 la cluster shared (TENANT): khong co version/disk/oplog/backup/autoscaling tuy chinh.
  is_free_cluster = var.instance_size == "M0"
  default_tags = {
    env        = var.env
    managed_by = "terraform"
  }
  applied_tags = merge(var.tags, local.default_tags)

  database_users_by_username = {
    for user in var.database_users : user.username => user
  }
}
