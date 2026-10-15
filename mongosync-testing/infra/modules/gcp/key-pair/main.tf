# Sinh 1 cap SSH key ed25519 cho lab va ghi ra ~/.ssh/<key_pair_name>(.pub).
# Private key cung nam trong Terraform state => state la file nhay cam, khong commit.
resource "tls_private_key" "ssh_key" {
  algorithm = "ED25519"
}

resource "local_sensitive_file" "private_key_file" {
  content         = tls_private_key.ssh_key.private_key_openssh
  filename        = pathexpand("~/.ssh/${var.key_pair_name}")
  file_permission = "0600"
}

resource "local_file" "public_key_file" {
  content         = tls_private_key.ssh_key.public_key_openssh
  filename        = pathexpand("~/.ssh/${var.key_pair_name}.pub")
  file_permission = "0644"
}
