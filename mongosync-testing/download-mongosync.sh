#!/usr/bin/env bash
# Tai mongosync (ban tgz cho Ubuntu) va giai nen vao ./mongosync-ubuntu2404
# (folder nay duoc mount vao container `mongosync` tai /mongosync, va bi .gitignore vi binary ~70MB).
#
# Dung:
#   ./download-mongosync.sh                 # ban mac dinh
#   ./download-mongosync.sh 1.21.0          # chon version
#   FORCE=1 ./download-mongosync.sh         # tai de len ban da co
#   PLATFORM=ubuntu2204 ARCH=aarch64 ./download-mongosync.sh
#
# Chay duoc tren Git Bash / WSL / Linux (can: curl, tar).
set -euo pipefail

VERSION="${1:-${MONGOSYNC_VERSION:-1.22.0}}"
PLATFORM="${PLATFORM:-ubuntu2404}"
ARCH="${ARCH:-x86_64}"
BASE_URL="${BASE_URL:-https://fastdl.mongodb.org/tools/mongosync}"

cd "$(dirname "${BASH_SOURCE[0]}")"
NAME="mongosync-${PLATFORM}-${ARCH}-${VERSION}"
URL="${BASE_URL}/${NAME}.tgz"
DEST="mongosync-${PLATFORM}"   # compose mount ./mongosync-ubuntu2404 => /mongosync

if [ -x "${DEST}/bin/mongosync" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Da co ${DEST}/bin/mongosync ($("./${DEST}/bin/mongosync" --version 2>/dev/null | head -1 || echo 'khong chay duoc tren may nay'))"
  echo "Dung FORCE=1 de tai lai."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading ${URL}"
PROGRESS="-sS"; [ -t 2 ] && PROGRESS="--progress-bar"   # chi hien thanh tien do khi chay trong terminal
if ! curl -fL --retry 3 ${PROGRESS} -o "${TMP}/${NAME}.tgz" "${URL}"; then
  echo "ERROR: tai that bai. Kiem tra version/platform/arch (xem https://www.mongodb.com/try/download/mongosync)" >&2
  exit 1
fi

# MongoDB khong cong bo file checksum cho mongosync => chi in sha256 de doi chieu thu cong neu can
if command -v sha256sum >/dev/null 2>&1; then
  echo "sha256: $(sha256sum "${TMP}/${NAME}.tgz" | cut -d' ' -f1)"
fi

# Chi xoa NOI DUNG (khong xoa folder) de container dang mount ./${DEST} van thay file moi
mkdir -p "${DEST}"
find "${DEST}" -mindepth 1 -delete
tar -xzf "${TMP}/${NAME}.tgz" -C "${DEST}" --strip-components=1
chmod +x "${DEST}/bin/mongosync"

echo "OK: ${DEST}/bin/mongosync"
"./${DEST}/bin/mongosync" --version 2>/dev/null | head -1 || echo "(binary la Linux: chay trong container, khong chay duoc tren Windows)"
