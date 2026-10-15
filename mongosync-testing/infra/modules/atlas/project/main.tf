resource "mongodbatlas_project" "main" {
  name   = var.project_name
  org_id = var.org_id

  tags = local.applied_tags

  lifecycle {
    ignore_changes = [teams]
  }
}

resource "mongodbatlas_project_ip_access_list" "ip_access_list" {
  for_each   = { for val in var.project_ip_access_list : val.cidr_block => val }
  project_id = mongodbatlas_project.main.id
  cidr_block = each.value.cidr_block
  comment    = each.value.comment
}

resource "mongodbatlas_network_container" "subnet" {
  count            = var.enable_peering ? 1 : 0
  project_id       = mongodbatlas_project.main.id
  atlas_cidr_block = var.atlas_cidr_block
  provider_name    = var.provider_name != "" ? var.provider_name : "GCP"
  regions          = [var.atlas_region]
}

resource "mongodbatlas_network_peering" "to_gcp" {
  count          = var.enable_peering ? length(var.peering_info) : 0
  project_id     = mongodbatlas_project.main.id
  container_id   = mongodbatlas_network_container.subnet[0].id
  provider_name  = var.provider_name != "" ? var.provider_name : "GCP"
  gcp_project_id = var.peering_info[count.index].project_id
  network_name   = var.peering_info[count.index].network_name
}

resource "google_compute_network_peering" "from_gcp" {
  count        = var.enable_peering ? length(var.peering_info) : 0
  name         = "peering-with-mongodb-atlas-${var.env}-${count.index + 1}"
  network      = var.peering_info[count.index].network_self_link
  peer_network = "https://www.googleapis.com/compute/v1/projects/${mongodbatlas_network_peering.to_gcp[count.index].atlas_gcp_project_id}/global/networks/${mongodbatlas_network_peering.to_gcp[count.index].atlas_vpc_name}"
}

resource "random_password" "random_password" {
  for_each         = local.project_users_by_username
  length           = 16
  special          = true
  override_special = "!*()-_"

  lifecycle {
    ignore_changes = [override_special, special, length]
  }
}

resource "mongodbatlas_database_user" "project_users" {
  for_each           = local.project_users_by_username
  username           = each.value.username
  password           = random_password.random_password[each.key].result
  project_id         = mongodbatlas_project.main.id
  auth_database_name = "admin"

  dynamic "roles" {
    for_each = { for idx, val in each.value.roles : idx => val }
    content {
      role_name     = roles.value.role_name
      database_name = roles.value.database_name
    }
  }
}

