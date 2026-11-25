#!/usr/bin/env bash
# JEE NEXUS — full local verification of the M24 chat feature.
# Postgres (userspace) -> migrations 0001..0007 -> taxonomy+seed -> prisma generate
# -> dev server -> chat e2e + regression e2e + core API e2e.
set -uo pipefail
cd /home/z/my-project
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres"
export ADMIN_EMAILS="admin@jee-nexus.dev"

echo "== 1. local postgres =="
bash scripts/local_pg.sh init || bash scripts/local_pg.sh start || exit 1
# put userspace pg binaries (psql etc.) on PATH for the rest of this script
PKG_DIR=$(python3 -c "import postgresql_binaries, os; print(os.path.dirname(postgresql_binaries.__file__))")
VER_DIR=$(ls -d /tmp/pgbin/postgresql-*/ | head -1)
export PATH="$VER_DIR/bin:$PATH"

echo "== 2. migrations 0001..0007 =="
PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGPASSWORD=postgres
export PGHOST PGPORT PGUSER PGPASSWORD
for m in supabase/migrations/0*.sql; do
  if psql -q -v ON_ERROR_STOP=1 -f "$m" >/dev/null 2>&1; then
    echo "  applied $(basename "$m")"
  else
    echo "  SKIP/FAIL $(basename "$m")"
  fi
done
psql -q -t -c "select count(*) || ' tables' from information_schema.tables where table_schema='public'"

echo "== 3. prisma generate =="
bunx prisma generate 2>&1 | grep -E "Generated|Error" | head -3

echo "== 4. seeds =="
bun scripts/upsert_taxonomy.ts 2>&1 | tail -2
bun scripts/seed.ts 2>&1 | tail -3

echo "== 5. dev server =="
bash scripts/ensure_dev.sh || exit 1

echo "== 6. e2e suites =="
python3 scripts/e2e_chat_test.py 2>&1 | tail -15
echo "---- regression ----"
python3 scripts/regression_fixes_20251125.py 2>&1 | tail -12
echo "---- core api ----"
python3 scripts/e2e_api_test.py 2>&1 | tail -6
