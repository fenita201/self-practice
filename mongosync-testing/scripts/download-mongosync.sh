#!/usr/bin/env bash
# Tai mongosync (ban tgz cho Ubuntu) va giai nen vao <repo>/bin/mongosync (bi .gitignore, ~70MB).
# Container `mongosync` cua local/docker-compose.yml mount folder nay vao /mongosync.
# Chay duoc ca tren may local (WSL/Linux/Git Bash) lan tren VM lab-sync-1.
#
# Dung:
#   ./download-mongosync.sh                      # ban mac dinh
#   ./download-mongosync.sh 1.21.0               # chon version
#   FORCE=1 ./download-mongosync.sh              # tai de len ban da co
#   PLATFORM=ubuntu2204 ARCH=aarch64 ./download-mongosync.sh
#   DEST=/opt/mongosync ./download-mongosync.sh  # doi thu muc dich
#
# Can: curl, tar. Danh sach version: https://www.mongodb.com/try/download/mongosync
set -euo pipefail

VERSION="${1:-${MONGOSYNC_VERSION:-1.22.0}}"
PLATFORM="${PLATFORM:-ubuntu2404}"
ARCH="${ARCH:-x86_64}"
BASE_URL="${BASE_URL:-https://fastdl.mongodb.org/tools/mongosync}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${DEST:-${SCRIPT_DIR}/../bin/mongosync}"
NAME="mongosync-${PLATFORM}-${ARCH}-${VERSION}"
URL="${BASE_URL}/${NAME}.tgz"

# Binary la Linux x86_64 va can libgssapi-krb5-2: chay khong duoc thi chi bo qua phan in version
binary_version() { "${DEST}/bin/mongosync" --version 2>/dev/null | head -1 || true; }

if [ -x "${DEST}/bin/mongosync" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Da co ${DEST}/bin/mongosync ($(binary_version))"
  echo "Dung FORCE=1 de tai lai."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading ${URL}"
PROGRESS="-sS"; [ -t 2 ] && PROGRESS="--progress-bar"
if ! curl -fL --retry 3 ${PROGRESS} -o "${TMP}/${NAME}.tgz" "${URL}"; then
  echo "ERROR: tai that bai. Kiem tra version/platform/arch (https://www.mongodb.com/try/download/mongosync)" >&2
  exit 1
fi

# MongoDB khong cong bo file checksum rieng cho mongosync => in sha256 de doi chieu thu cong neu can
if command -v sha256sum >/dev/null 2>&1; then
  echo "sha256: $(sha256sum "${TMP}/${NAME}.tgz" | cut -d' ' -f1)"
fi

# Chi xoa NOI DUNG (khong xoa folder) de container dang mount folder nay van thay file moi
mkdir -p "${DEST}"
find "${DEST}" -mindepth 1 -delete
tar -xzf "${TMP}/${NAME}.tgz" -C "${DEST}" --strip-components=1
chmod +x "${DEST}/bin/mongosync"

echo "OK: ${DEST}/bin/mongosync"
v="$(binary_version)"; echo "${v:-(chua chay duoc binary tren may nay: can Linux x86_64 + libgssapi-krb5-2)}"
