#!/usr/bin/env bash
# Dev helper (Windows + WSL): mirror the source tree into a native Linux dir and
# run a command there, so node_modules/esbuild/inotify behave like on the server.
#   wsl -d Ubuntu-26.04 -e bash -lc '/mnt/d/tmp/self-practice/claude-web-remote/scripts/sync-wsl.sh npm test'
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST="${CR_WSL_DIR:-$HOME/claude-remote}"
mkdir -p "$DST"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude data --exclude .env \
  --exclude '*.md' --exclude mo-ta.txt \
  "$SRC/" "$DST/"
cp "$SRC"/*.md "$DST/" 2>/dev/null || true
cd "$DST"
# shellcheck disable=SC1090
[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" >/dev/null
[ -d node_modules ] || npm ci
if [ $# -gt 0 ]; then "$@"; fi
