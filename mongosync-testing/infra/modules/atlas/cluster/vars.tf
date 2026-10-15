variable "env" {
  type    = string
  default = "test"
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "atlas_region" {
  type = string
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

variable "enable_mongosync_permissions" {
  type    = bool
  default = false

  validation {
    condition     = !var.enable_mongosync_permissions || var.instance_size != "M0"
    error_message = "M0 does not support mongosync; disable enable_mongosync_permissions."
  }
}

variable "provider_name" {
  type    = string
  default = "GCP"
}

variable "project_id" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "cluster_type" {
  type    = string
  default = "REPLICASET"
}

variable "major_version" {
  type    = string
  default = "8.0"
}

variable "fcv_expiration_date" {
  type    = string
  default = ""
}

variable "instance_size" {
  type = string
}

variable "node_count" {
  type    = number
  default = 3
}

variable "disk_size_gb" {
  type    = number
  default = 50
}

variable "compute_auto_scaling_enabled" {
  type    = bool
  default = false
}

variable "storage_auto_scaling_enabled" {
  type    = bool
  default = false
}

variable "auto_scaling_min_instance_size" {
  type    = string
  default = ""
}

variable "auto_scaling_max_instance_size" {
  type    = string
  default = ""
}

variable "oplog_size_mb" {
  type    = number
  default = null
}
variable "oplog_min_retention_hours" {
  type    = number
  default = 24
}

variable "database_users" {
  type = list(object({
    username = string
    roles = list(object({
      role_name     = string
      database_name = string
    }))
  }))
  default = []

  validation {
    condition     = length(var.database_users) == length(distinct([for user in var.database_users : user.username]))
    error_message = "database_users usernames must be unique."
  }
}

variable "backup_enabled" {
  type    = bool
  default = false
}

variable "pit_enabled" {
  type    = bool
  default = false
}

variable "cloud_backup" {
  type = object({
    reference_hour_of_day    = optional(number)
    reference_minute_of_hour = optional(number)
    restore_window_days      = optional(number)
    policy_item_hourly = optional(object({
      frequency_interval = number
      retention_unit     = string
      retention_value    = number
    }))
    policy_item_daily = optional(object({
      frequency_interval = number
      retention_unit     = string
      retention_value    = number
    }))
    policy_item_weekly = optional(object({
      frequency_interval = number
      retention_unit     = string
      retention_value    = number
    }))
    policy_item_monthly = optional(object({
      frequency_interval = number
      retention_unit     = string
      retention_value    = number
    }))
    policy_item_yearly = optional(object({
      frequency_interval = number
      retention_unit     = string
      retention_value    = number
    }))
  })
  default = {}
}
