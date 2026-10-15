resource "google_project" "main" {
  count           = var.create_project ? 1 : 0
  name            = var.project_name == "" ? var.project : var.project_name
  project_id      = var.project
  folder_id       = var.folder_id
  billing_account = var.billing_account

  auto_create_network = false

  deletion_policy = "PREVENT" # change to DELETE to allow project deletion

  labels = local.applied_labels
}

data "google_project" "existing" {
  count      = var.create_project ? 0 : 1
  project_id = var.project
}

resource "google_project_service" "enabled_apis" {
  for_each = toset(var.enable_apis)

  project = var.create_project ? google_project.main[0].project_id : data.google_project.existing[0].project_id
  service = each.key

  disable_on_destroy = false
}
