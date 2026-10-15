output "project" {
  value = {
    org_id        = mongodbatlas_project.main.org_id
    id            = mongodbatlas_project.main.id
    name          = mongodbatlas_project.main.name
    cluster_count = mongodbatlas_project.main.cluster_count
  }
}

output "network_container" {
  value = var.enable_peering ? {
    id               = mongodbatlas_network_container.subnet[0].id
    container_id     = mongodbatlas_network_container.subnet[0].container_id
    atlas_cidr_block = mongodbatlas_network_container.subnet[0].atlas_cidr_block
    provider_name    = mongodbatlas_network_container.subnet[0].provider_name
    regions          = mongodbatlas_network_container.subnet[0].regions
  } : null
}

output "project_users" {
  value = {
    for pu in mongodbatlas_database_user.project_users :
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

