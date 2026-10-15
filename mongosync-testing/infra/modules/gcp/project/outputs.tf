output "project" {
  value = {
    id              = var.create_project ? google_project.main[0].project_id : data.google_project.existing[0].project_id
    folder_id       = var.create_project ? google_project.main[0].folder_id : data.google_project.existing[0].folder_id
    billing_account = var.create_project ? google_project.main[0].billing_account : data.google_project.existing[0].billing_account
    name            = var.create_project ? google_project.main[0].name : data.google_project.existing[0].name
    number          = var.create_project ? google_project.main[0].number : data.google_project.existing[0].number
  }
}
