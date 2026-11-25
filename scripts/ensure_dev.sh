#!/usr/bin/env bash
# Ensure the local dev server is up (restart if the sandbox recycled it).
set -uo pipefail
if curl -s -o /dev/null -m 3 http://localhost:3000/ 2>/dev/null; then
  echo "dev server already up"
  exit 0
fi
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 1
cd /home/z/my-project
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres"
export ADMIN_EMAILS="admin@jee-nexus.dev"
(setsid nohup bun run dev > /tmp/dev.log 2>&1 < /dev/null &)
for i in $(seq 1 60); do
  sleep 2
  if curl -s -o /dev/null -m 3 http://localhost:3000/ 2>/dev/null; then
    echo "dev server restarted after ~$((i*2))s"
    # warm the routes we test against
    for ep in /api/taxonomy /api/pyq /api/chat/conversations /api/chat/users; do
      curl -s -o /dev/null -m 40 "http://localhost:3000$ep"
    done
    exit 0
  fi
done
echo "FAILED to start dev server" >&2
exit 1
