#!/usr/bin/env bash
# Live endpoint sweep — bug hunt. Usage: bash scripts/live_sweep.sh
BASE="https://jee-nexus-app.jee-nexus.workers.dev"
JAR=$(mktemp)
echo "== login =="
curl -s -c "$JAR" -H 'content-type: application/json' \
  -d '{"email":"admin@jee-nexus.dev","password":"admin-pass-123"}' \
  "$BASE/api/auth/login" -o /tmp/sweep_login -w "login: %{http_code}\n"
head -c 200 /tmp/sweep_login; echo

for ep in \
  "/api/auth/me" \
  "/api/taxonomy" \
  "/api/stats" \
  "/api/bookmarks" \
  "/api/pyq?year=2024" \
  "/api/chat/users" \
  "/api/chat/conversations" \
  "/api/chat/search?q=phy" \
  "/api/exam/patterns" \
  ; do
  code=$(curl -s -b "$JAR" -o /tmp/sweep_out -w "%{http_code}" "$BASE$ep")
  size=$(wc -c < /tmp/sweep_out)
  echo "$code  $size  $ep"
done

echo "== random selection =="
code=$(curl -s -b "$JAR" -o /tmp/sweep_rand -w "%{http_code}" \
  -H 'content-type: application/json' -d '{"count":3,"subjects":["physics"]}' \
  "$BASE/api/questions/random")
echo "random: $code ($(wc -c < /tmp/sweep_rand) bytes)"
python3 -c "
import json
d=json.load(open('/tmp/sweep_rand'))
qs=d.get('questions',[])
print('got', len(qs), 'questions;', 'ids:', [q.get('id') for q in qs][:5])
" 2>&1 | head -3

echo "== question detail =="
QID=$(python3 -c "
import json
d=json.load(open('/tmp/sweep_rand'))
qs=d.get('questions',[])
print(qs[0]['id'] if qs else '')
" 2>/dev/null)
if [ -n "$QID" ]; then
  code=$(curl -s -b "$JAR" -o /tmp/sweep_detail -w "%{http_code}" "$BASE/api/questions/$QID")
  echo "detail $QID: $code ($(wc -c < /tmp/sweep_detail) bytes)"
fi

echo "== submit+grade =="
if [ -n "$QID" ]; then
  code=$(curl -s -b "$JAR" -o /tmp/sweep_grade -w "%{http_code}" \
    -H 'content-type: application/json' \
    -d "{\"questionId\":\"$QID\",\"selectedOptionIds\":[],\"numericalAnswer\":\"42\"}" \
    "$BASE/api/questions/submit")
  echo "submit: $code"; head -c 300 /tmp/sweep_grade; echo
fi
rm -f "$JAR"
