resource "mongodbatlas_advanced_cluster" "main" {
  project_id             = var.project_id
  name                   = var.cluster_name
  cluster_type           = var.cluster_type
  mongo_db_major_version = local.is_free_cluster ? null : var.major_version
  pinned_fcv = local.is_free_cluster || var.fcv_expiration_date == "" ? null : {
    expiration_date = var.fcv_expiration_date
  }

  use_effective_fields = local.is_free_cluster ? null : true

  backup_enabled = local.is_free_cluster ? null : var.backup_enabled
  pit_enabled    = local.is_free_cluster ? null : var.pit_enabled

  replication_specs = [{
    region_configs = [{
      electable_specs = merge({
        instance_size = var.instance_size
        }, local.is_free_cluster ? {} : {
        node_count   = var.node_count
        disk_size_gb = var.disk_size_gb
      })

      auto_scaling = local.is_free_cluster ? null : {
        disk_gb_enabled            = var.storage_auto_scaling_enabled
        compute_enabled            = var.compute_auto_scaling_enabled
        compute_scale_down_enabled = var.compute_auto_scaling_enabled
        compute_min_instance_size  = var.compute_auto_scaling_enabled ? var.auto_scaling_min_instance_size : null
        compute_max_instance_size  = var.compute_auto_scaling_enabled ? var.auto_scaling_max_instance_size : null
      }

      provider_name         = local.is_free_cluster ? "TENANT" : var.provider_name
      backing_provider_name = local.is_free_cluster ? var.provider_name : null
      priority              = 7
      region_name           = var.atlas_region
    }]
  }]

  advanced_configuration = local.is_free_cluster ? null : {
    oplog_size_mb             = var.storage_auto_scaling_enabled ? (var.oplog_min_retention_hours == 0 ? (coalesce(var.oplog_size_mb, 0) == 0 ? floor(var.disk_size_gb * 1024 * 0.1) : var.oplog_size_mb) : null) : (coalesce(var.oplog_size_mb, 0) == 0 ? floor(var.disk_size_gb * 1024 * 0.1) : var.oplog_size_mb)
    oplog_min_retention_hours = var.storage_auto_scaling_enabled ? var.oplog_min_retention_hours : 0
  }

  tags = local.applied_tags
}

# Atlas khong cho gan built-in role + custom action tuy y cho 1 user => gop vao 1 custom role.
resource "mongodbatlas_custom_db_role" "mongosync_destination" {
  count      = var.enable_mongosync_permissions ? 1 : 0
  project_id = var.project_id
  role_name  = "mongosyncDestination"

  inherited_roles {
    role_name     = "atlasAdmin"
    database_name = "admin"
  }

  actions {
    action = "BYPASS_USER_WRITE_BLOCK"
    resources {
      cluster = true
    }
  }
}

resource "random_password" "random_password" {
  for_each         = local.database_users_by_username
  length           = 16
  special          = true
  override_special = "!*()-_"

  lifecycle {
    ignore_changes = [override_special, special, length]
  }
}

resource "mongodbatlas_database_user" "database_users" {
  depends_on         = [mongodbatlas_custom_db_role.mongosync_destination]
  for_each           = local.database_users_by_username
  username           = each.value.username
  password           = random_password.random_password[each.key].result
  project_id         = var.project_id
  auth_database_name = "admin"

  dynamic "roles" {
    for_each = { for idx, val in each.value.roles : idx => val }
    content {
      role_name     = roles.value.role_name
      database_name = roles.value.database_name
    }
  }

  scopes {
    name = mongodbatlas_advanced_cluster.main.name
    type = "CLUSTER"
  }
}

resource "mongodbatlas_cloud_backup_schedule" "backup_schedule" {
  count        = !local.is_free_cluster && var.backup_enabled ? 1 : 0
  project_id   = var.project_id
  cluster_name = mongodbatlas_advanced_cluster.main.name

  reference_hour_of_day    = var.cloud_backup.reference_hour_of_day
  reference_minute_of_hour = var.cloud_backup.reference_minute_of_hour
  restore_window_days      = var.cloud_backup.restore_window_days

  # auto_export_enabled = var.snapshot_auto_export_enabled
  # dynamic "export" {
  #   for_each = var.snapshot_auto_export_enabled ? [1] : []
  #   content {
  #     export_bucket_id = var.snapshot_export_bucket_id
  #     frequency_type   = var.snapshot_export_frequency_type
  #   }
  # }
  dynamic "policy_item_hourly" {
    for_each = var.cloud_backup.policy_item_hourly != null ? [var.cloud_backup.policy_item_hourly] : []
    content {
      frequency_interval = policy_item_hourly.value.frequency_interval
      retention_unit     = policy_item_hourly.value.retention_unit
      retention_value    = policy_item_hourly.value.retention_value
    }
  }

  dynamic "policy_item_daily" {
    for_each = var.cloud_backup.policy_item_daily != null ? [var.cloud_backup.policy_item_daily] : []
    content {
      frequency_interval = policy_item_daily.value.frequency_interval
      retention_unit     = policy_item_daily.value.retention_unit
      retention_value    = policy_item_daily.value.retention_value
    }
  }

  dynamic "policy_item_weekly" {
    for_each = var.cloud_backup.policy_item_weekly != null ? [var.cloud_backup.policy_item_weekly] : []
    content {
      frequency_interval = policy_item_weekly.value.frequency_interval
      retention_unit     = policy_item_weekly.value.retention_unit
      retention_value    = policy_item_weekly.value.retention_value
    }
  }

  dynamic "policy_item_monthly" {
    for_each = var.cloud_backup.policy_item_monthly != null ? [var.cloud_backup.policy_item_monthly] : []
    content {
      frequency_interval = policy_item_monthly.value.frequency_interval
      retention_unit     = policy_item_monthly.value.retention_unit
      retention_value    = policy_item_monthly.value.retention_value
    }
  }

  dynamic "policy_item_yearly" {
    for_each = var.cloud_backup.policy_item_yearly != null ? [var.cloud_backup.policy_item_yearly] : []
    content {
      frequency_interval = policy_item_yearly.value.frequency_interval
      retention_unit     = policy_item_yearly.value.retention_unit
      retention_value    = policy_item_yearly.value.retention_value
    }
  }
}
