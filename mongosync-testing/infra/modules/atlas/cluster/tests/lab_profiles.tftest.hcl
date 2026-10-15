# mock providers kiểm tra hai profile mà không tạo cluster/tính phí.
mock_provider "mongodbatlas" {}
mock_provider "random" {}


variables {
  atlas_region = "CENTRAL_US"
  project_id   = "000000000000000000000000"
  cluster_name = "lab-test"
}

run "m0_uses_tenant_without_dedicated_features" {
  command = plan

  variables {
    instance_size = "M0"
  }

  assert {
    condition     = mongodbatlas_advanced_cluster.main.replication_specs[0].region_configs[0].provider_name == "TENANT" && mongodbatlas_advanced_cluster.main.replication_specs[0].region_configs[0].backing_provider_name == "GCP"
    error_message = "M0 must use TENANT backed by GCP."
  }

  assert {
    condition     = mongodbatlas_advanced_cluster.main.use_effective_fields == null && length(mongodbatlas_cloud_backup_schedule.backup_schedule) == 0 && length(mongodbatlas_custom_db_role.mongosync_destination) == 0
    error_message = "M0 must not create dedicated backup or mongosync roles."
  }
}

run "m10_has_three_nodes_and_mongosync_role" {
  command = plan

  variables {
    instance_size                = "M10"
    disk_size_gb                 = 10
    enable_mongosync_permissions = true
    database_users = [{
      username = "mongosync"
      roles    = [{ role_name = "mongosyncDestination", database_name = "admin" }]
    }]
  }

  assert {
    condition     = mongodbatlas_advanced_cluster.main.replication_specs[0].region_configs[0].provider_name == "GCP" && mongodbatlas_advanced_cluster.main.replication_specs[0].region_configs[0].electable_specs.node_count == 3
    error_message = "M10 must use GCP directly with three replica-set nodes."
  }

  assert {
    condition     = length(mongodbatlas_custom_db_role.mongosync_destination) == 1 && contains([for action in mongodbatlas_custom_db_role.mongosync_destination[0].actions : action.action], "BYPASS_USER_WRITE_BLOCK")
    error_message = "M10 mongosync destination must get the write-block bypass action."
  }
}

run "m0_rejects_mongosync_permissions" {
  command = plan
  variables {
    instance_size                = "M0"
    enable_mongosync_permissions = true
  }
  expect_failures = [var.enable_mongosync_permissions]
}
