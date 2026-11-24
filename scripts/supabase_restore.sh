#!/usr/bin/env bash
# Restore the paused Supabase project and poll until ACTIVE (or timeout).
# Target: the default-named project (likely unused); preparena is left untouched.
set -u
. /home/z/my-project/.secrets/tokens.env
REF="mxfiazcjcgqzqynmsefp"

echo "Requesting restore for project $REF ..."
code=$(curl -sS -m 30 -X POST -H "Authorization: Bearer $SB_PAT" \
  "https://api.supabase.com/v1/projects/$REF/restore" -o /tmp/sb_restore.json -w '%{http_code}')
echo "restore HTTP $code: $(python3 -c "import json;print(str(json.load(open('/tmp/sb_restore.json')))[:200])" 2>/dev/null)"

for i in $(seq 1 60); do
  sleep 10
  status=$(curl -sS -m 20 -H "Authorization: Bearer $SB_PAT" "https://api.supabase.com/v1/projects/$REF" 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin).get('status'))" 2>/dev/null)
  echo "[poll $i] status: $status"
  if [ "$status" = "ACTIVE" ]; then
    echo "PROJECT ACTIVE"
    exit 0
  fi
done
echo "TIMEOUT waiting for ACTIVE"
exit 1
