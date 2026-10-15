# N VM giong nhau, ten "<env>-<platform>-<i>", IP noi bo co dinh (replica set giu member khi tao lai VM).
# Khong co public IP mac dinh: SSH qua IAP, ra Internet qua Cloud NAT cua module vpc.
resource "google_compute_address" "internal_ip" {
  count        = var.num_instances
  name         = "${var.env}-${var.platform}-${count.index + 1}-int"
  project      = var.project
  region       = var.region
  subnetwork   = var.subnet
  address_type = "INTERNAL"
  address      = length(var.internal_ips) == 0 ? null : var.internal_ips[count.index]
}

resource "google_compute_address" "external_ip" {
  count   = var.enable_external_ip ? var.num_instances : 0
  name    = "${var.env}-${var.platform}-${count.index + 1}-ext"
  project = var.project
  region  = var.region
}

resource "google_compute_instance" "main_instance" {
  count = var.num_instances

  name                      = "${var.env}-${var.platform}-${count.index + 1}"
  project                   = var.project
  zone                      = "${var.region}-${var.zone}"
  machine_type              = var.machine_type
  tags                      = var.tags
  allow_stopping_for_update = true

  labels = merge(local.labels, { platform = var.platform })

  boot_disk {
    initialize_params {
      image = var.os_image
      size  = var.boot_disk_size
      type  = var.boot_disk_type
    }
  }

  network_interface {
    subnetwork = var.subnet
    network_ip = google_compute_address.internal_ip[count.index].address

    dynamic "access_config" {
      for_each = var.enable_external_ip ? [1] : []
      content {
        nat_ip = google_compute_address.external_ip[count.index].address
      }
    }
  }

  metadata = {
    ssh-keys = "${var.ssh_user}:${var.ssh_public_key}"
  }

  metadata_startup_script = var.startup_script != "" ? var.startup_script : null

  lifecycle {
    ignore_changes = [boot_disk[0].initialize_params[0].image]
  }
}

locals {
  labels = merge(var.labels, {
    env        = var.env
    managed_by = "terraform"
  })
}
