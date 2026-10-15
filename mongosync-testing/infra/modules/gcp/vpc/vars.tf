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

variable "subnets" {       # format:
  type = map(list(string)) #   subnet_name: ["primary", "secondary1", "secondary2", "..."]
}

variable "static_nat_ip_enabled" {
  type    = bool
  default = false
}