variable "env" {
  type = string
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "project" {
  type = string
}

variable "region" {
  type = string
}

variable "zone" {
  description = "Hau to zone, vd \"a\" => us-central1-a"
  type        = string
  default     = "a"
}

variable "platform" {
  description = "Vai tro cua nhom VM, dung trong ten VM: src | dst | sync"
  type        = string
}

variable "num_instances" {
  type    = number
  default = 1
}

variable "internal_ips" {
  description = "IP noi bo co dinh, 1 IP / VM. De trong = GCP tu cap."
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.internal_ips) == 0 || length(var.internal_ips) == var.num_instances
    error_message = "internal_ips must be empty or contain one address per instance."
  }
}

variable "machine_type" {
  type = string
}

variable "os_image" {
  type = string
}

variable "boot_disk_size" {
  type    = number
  default = 20
}

variable "boot_disk_type" {
  type    = string
  default = "pd-standard"
}

variable "subnet" {
  description = "self_link cua subnet"
  type        = string
}

variable "tags" {
  description = "Network tag, firewall rule chon VM theo tag"
  type        = list(string)
  default     = []
}

variable "enable_external_ip" {
  type    = bool
  default = false
}

variable "ssh_user" {
  type    = string
  default = "ubuntu"
}

variable "ssh_public_key" {
  type = string
}

variable "startup_script" {
  type    = string
  default = ""
}
