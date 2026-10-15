terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "3.8.1"
    }
    mongodbatlas = {
      source  = "mongodb/mongodbatlas"
      version = "2.7.0"
    }
    google = {
      source  = "hashicorp/google"
      version = ">= 7.0.0"
    }
  }
}

provider "mongodbatlas" {
  public_key  = var.mongodbatlas_public_key
  private_key = var.mongodbatlas_private_key
}

provider "google" {
  project = var.project
  region  = var.region
}
