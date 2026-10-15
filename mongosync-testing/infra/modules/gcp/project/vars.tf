variable "env" {
  type    = string
  default = "lab"
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "project" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  type = string
}

variable "create_project" {
  description = "true = Terraform tao project moi (can billing_account). false = dung project co san, chi bat API."
  type        = bool
  default     = false
}

variable "project_name" {
  type    = string
  default = ""
}

variable "folder_id" {
  type    = string
  default = null
}

variable "billing_account" {
  type    = string
  default = null
}

variable "enable_apis" {
  type = list(string)
}
