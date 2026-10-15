#!/usr/bin/env bash
# Cai MongoDB Community len 1 VM Ubuntu va cau hinh lam member cua replica set,
# bat san auth + keyFile (keyFile phai duoc copy len VM truoc, xem docs/03-source-cluster.md).
#
# Dung (tren tung VM):
#   sudo RS_NAME=src-rs bash install-mongodb.sh
# Tuy chon:
#   MONGO_VERSION=8.0   KEYFILE_SRC=/tmp/mongodb-keyfile   CACHE_GB=0.25   OPLOG_MB=2048
set -euo pipefail

RS_NAME="${RS_NAME:?can RS_NAME, vd src-rs hoac dst-rs}"
MONGO_VERSION="${MONGO_VERSION:-8.0}"
KEYFILE_SRC="${KEYFILE_SRC:-/tmp/mongodb-keyfile}"
CACHE_GB="${CACHE_GB:-0.25}"   # WiredTiger cache; VM nho thi de thap de khong bi OOM
OPLOG_MB="${OPLOG_MB:-2048}"   # oplog phai du lon de giu change event trong suot initial copy

[ "$(id -u)" = 0 ] || { echo "Chay bang sudo" >&2; exit 1; }
[ -s "$KEYFILE_SRC" ] || { echo "Khong thay keyFile tai $KEYFILE_SRC" >&2; exit 1; }

. /etc/os-release
echo "==> Cai mongodb-org ${MONGO_VERSION} cho Ubuntu ${VERSION_CODENAME}"
apt-get update -q
apt-get install -y -q gnupg curl jq
curl -fsSL "https://www.mongodb.org/static/pgp/server-${MONGO_VERSION}.asc" \
  | gpg --dearmor --yes -o "/usr/share/keyrings/mongodb-server-${MONGO_VERSION}.gpg"
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-${MONGO_VERSION}.gpg ] https://repo.mongodb.org/apt/ubuntu ${VERSION_CODENAME}/mongodb-org/${MONGO_VERSION} multiverse" \
  > "/etc/apt/sources.list.d/mongodb-org-${MONGO_VERSION}.list"
apt-get update -q
apt-get install -y -q mongodb-org

echo "==> Cai keyFile"
install -o mongodb -g mongodb -m 400 "$KEYFILE_SRC" /etc/mongodb-keyfile

PRIVATE_IP="$(hostname -I | awk '{print $1}')"
echo "==> Ghi /etc/mongod.conf (bind 127.0.0.1,${PRIVATE_IP}, replSet ${RS_NAME})"
cat > /etc/mongod.conf <<CONF
storage:
  dbPath: /var/lib/mongodb
  wiredTiger:
    engineConfig:
      cacheSizeGB: ${CACHE_GB}
systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log
net:
  port: 27017
  bindIp: 127.0.0.1,${PRIVATE_IP}
processManagement:
  timeZoneInfo: /usr/share/zoneinfo
replication:
  replSetName: ${RS_NAME}
  oplogSizeMB: ${OPLOG_MB}
security:
  authorization: enabled
  keyFile: /etc/mongodb-keyfile
CONF

systemctl enable mongod
systemctl restart mongod
for i in $(seq 1 30); do
  mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' >/dev/null 2>&1 && break
  sleep 1
done
systemctl --no-pager --lines=0 status mongod
echo "OK: mongod dang chay. Buoc tiep: chay init-replset.js tren node dau tien."
