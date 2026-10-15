variable "env" {
  type    = string
  default = "test"
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

variable "firewall_rules" {
  type = object({
    ingresses = list(object({
      name          = string
      network       = string
      priority      = number
      source_ranges = list(string)
      target_tags   = list(string)
      protocol      = string
      ports         = list(string)
      description   = string
    }))
    egresses = list(object({
      name               = string
      network            = string
      priority           = number
      destination_ranges = list(string)
      target_tags        = list(string)
      protocol           = string
      ports              = list(string)
      description        = string
    }))
  })
}