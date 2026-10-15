output "cluster" {
  value = {
    cluster_id   = mongodbatlas_advanced_cluster.main.cluster_id
    project_id   = mongodbatlas_advanced_cluster.main.project_id
    cluster_type = mongodbatlas_advanced_cluster.main.cluster_type
    name         = mongodbatlas_advanced_cluster.main.name
    connection_strings = {
      private      = mongodbatlas_advanced_cluster.main.connection_strings.private
      private_srv  = mongodbatlas_advanced_cluster.main.connection_strings.private_srv
      standard     = mongodbatlas_advanced_cluster.main.connection_strings.standard
      standard_srv = mongodbatlas_advanced_cluster.main.connection_strings.standard_srv
    }
    backup_enabled         = mongodbatlas_advanced_cluster.main.backup_enabled
    pit_enabled            = mongodbatlas_advanced_cluster.main.pit_enabled
    mongo_db_major_version = mongodbatlas_advanced_cluster.main.mongo_db_major_version
    mongo_db_version       = mongodbatlas_advanced_cluster.main.mongo_db_version
  }
}

output "database_users" {
  value = {
    for pu in mongodbatlas_database_user.database_users :
    pu.username => {
      id                 = pu.id
      project_id         = pu.project_id
      auth_database_name = pu.auth_database_name
      username           = pu.username
      password           = pu.password
      roles              = pu.roles
      scopes             = pu.scopes
    }
  }
  sensitive = true
}
