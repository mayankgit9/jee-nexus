#!/usr/bin/env bash
# JEE NEXUS — guarded prisma db push.
# Refuses to run against the production Supabase database (the live schema is
# managed exclusively via supabase/migrations/*.sql through the SQL endpoint).
# Local/CI PostgreSQL URLs are allowed.
set -eu
cd /home/z/my-project

if printf '%s' "${DATABASE_URL:-}" | grep -qE 'supabase\.co|pooler\.supabase'; then
  echo "REFUSED: DATABASE_URL points at the production Supabase database."
  echo "The live schema is managed via supabase/migrations/*.sql (SQL endpoint) —"
  echo "never via 'prisma db push' (it runs with --accept-data-loss and would"
  echo "drop/recreate objects, destroying RLS policies)."
  exit 1
fi

exec bunx prisma db push --accept-data-loss
