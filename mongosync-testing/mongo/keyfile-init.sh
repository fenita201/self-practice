#!/bin/bash
# Sinh keyfile dung chung cho ca 2 cluster (idempotent).
set -e
KEY=/keyfile/keyfile
if [ ! -s "$KEY" ]; then
  head -c 600 /dev/urandom | base64 -w 0 > "$KEY"
  echo "keyfile generated"
fi
chown 999:999 "$KEY"
chmod 400 "$KEY"
