terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = ">= 2.5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = ">= 4.1.0"
    }
  }
  required_version = ">= 1.13.0"
}
