# kiểm tra project có sẵn chỉ được đọc, không tạo lại/xóa project.
mock_provider "google" {}


variables {
  project        = "mock-project"
  region         = "us-central1"
  create_project = false
  enable_apis    = ["compute.googleapis.com", "iap.googleapis.com"]
}

run "existing_project_only_enables_apis" {
  command = plan
  assert {
    condition     = length(google_project.main) == 0 && length(data.google_project.existing) == 1 && length(google_project_service.enabled_apis) == 2
    error_message = "Existing-project mode must not create a second Google project."
  }
}
