output "ssh_public_key" {
  value = tls_private_key.ssh_key.public_key_openssh
}

output "private_key_path" {
  value = local_sensitive_file.private_key_file.filename
}
