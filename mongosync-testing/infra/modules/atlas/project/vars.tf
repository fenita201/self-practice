variable "env" {
  type    = string
  default = "test"
}

variable "region" {
  type = string
}

variable "project" {
  type    = string
  default = null
}

variable "atlas_region" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "mongodbatlas_public_key" {
  type      = string
  default   = null
  sensitive = true
}

variable "mongodbatlas_private_key" {
  type      = string
  default   = null
  sensitive = true
}

variable "project_name" {
  type = string
}

variable "org_id" {
  type = string
}

variable "project_ip_access_list" {
  type = list(object({
    cidr_block = string
    comment    = string
  }))
  default = []
}

variable "provider_name" {
  type    = string
  default = "GCP"
}

variable "atlas_cidr_block" {
  type    = string
  default = null
}

variable "enable_peering" {
  type    = bool
  default = true
}

variable "peering_info" {
  type = list(object({
    project_id        = string
    network_name      = string
    network_self_link = string
  }))
  default = []
}

variable "project_users" {
  type = list(object({
    username = string
    roles = list(object({
      role_name     = string
      database_name = string
    }))
  }))
  default = []

  validation {
    condition     = length(var.project_users) == length(distinct([for user in var.project_users : user.username]))
    error_message = "project_users usernames must be unique."
  }
}
