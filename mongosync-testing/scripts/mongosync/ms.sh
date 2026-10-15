#!/usr/bin/env bash
# Helper goi HTTP API cua mongosync (mac dinh 127.0.0.1:27182). Can: curl, jq.
#
#   ms.sh progress            # in toan bo /progress
#   ms.sh status              # tom tat: state, canCommit, canWrite, phase, lag, % copy
#   ms.sh watch [giay]        # lap lai `status` moi N giay (mac dinh 5)
#   ms.sh start ['<json>']    # mac dinh {"source":"cluster0","destination":"cluster1"}
#   ms.sh pause | resume | commit | reverse
#
# Doi dia chi API: MONGOSYNC_API=http://127.0.0.1:27182/api/v1 ms.sh status
set -euo pipefail
API="${MONGOSYNC_API:-http://127.0.0.1:27182/api/v1}"

DEFAULT_START='{"source":"cluster0","destination":"cluster1"}'

post() { curl -sS -X POST "$API/$1" -H 'Content-Type: application/json' --data "$2" | jq; }

STATUS_JQ='.progress | {
  state, canCommit, canWrite,
  phase: .info,
  lagTimeSeconds,
  copied: (if .collectionCopy.estimatedTotalBytes > 0
           then ((.collectionCopy.estimatedCopiedBytes / .collectionCopy.estimatedTotalBytes * 100 | floor | tostring) + "%")
           else null end),
  verification: (.verification // null)
}'

case "${1:-status}" in
  progress) curl -sS "$API/progress" | jq ;;
  status)   curl -sS "$API/progress" | jq "$STATUS_JQ" ;;
  watch)    while true; do clear; date; curl -sS "$API/progress" | jq "$STATUS_JQ" || true; sleep "${2:-5}"; done ;;
  start)    post start "${2:-$DEFAULT_START}" ;;
  pause|resume|commit|reverse) post "$1" '{}' ;;
  *) sed -n '2,11p' "$0"; exit 1 ;;
esac
