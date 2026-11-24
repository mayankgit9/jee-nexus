#!/usr/bin/env bash
# JEE NEXUS — run a command with DATABASE_URL pointing at the sandbox's
# embedded PostgreSQL (scripts/pg_ensure.py). The gateway re-injects a stale
# SQLite DATABASE_URL on every shell call, which would break Prisma; always
# run dev-server/seed/prisma commands through this wrapper.
#
#   scripts/withdb.sh bun run dev
#   scripts/withdb.sh bunx tsx scripts/seed.ts
#   scripts/withdb.sh bunx prisma db push
set -euo pipefail
cd /home/z/my-project

python3 scripts/pg_ensure.py >/dev/null
export DATABASE_URL="postgresql://jee_app:jee_app_local@127.0.0.1:54329/jee_nexus"
exec "$@"
