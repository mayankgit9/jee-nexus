#!/usr/bin/env bash
# JEE NEXUS — local userspace PostgreSQL (no root needed).
# Binaries come from the pip package `postgresql-binaries` (PG 18.x tarball).
# Data dir: /tmp/pgdata · port 5433 · superuser postgres/postgres.
# Usage:
#   scripts/local_pg.sh init    # one-time: initdb + start + create role/db
#   scripts/local_pg.sh start   # start (if not running)
#   scripts/local_pg.sh stop
#   scripts/local_pg.sh status
set -euo pipefail

PKG_DIR=$(python3 -c "import postgresql_binaries, os; print(os.path.dirname(postgresql_binaries.__file__))")
VER_DIR=$(ls -d /tmp/pgbin/postgresql-*/ 2>/dev/null | head -1 || true)
if [[ -z "$VER_DIR" || ! -x "$VER_DIR/bin/pg_ctl" ]]; then
  # extract tarball once (per pip install) into /tmp/pgbin
  rm -rf /tmp/pgbin && mkdir -p /tmp/pgbin
  TARBALL=$(ls "$PKG_DIR"/postgresql-*.tar.gz | head -1)
  tar -xzf "$TARBALL" -C /tmp/pgbin
  VER_DIR=$(ls -d /tmp/pgbin/postgresql-*/ | head -1)
fi
export PATH="$VER_DIR/bin:$PATH"
PGDATA=/tmp/pgdata
PORT=5433
SOCK=/tmp

is_running() { pg_ctl -D "$PGDATA" status >/dev/null 2>&1; }

case "${1:-status}" in
  init)
    if [[ -d "$PGDATA" ]] && is_running; then echo "already running"; exit 0; fi
    rm -rf "$PGDATA"
    initdb -D "$PGDATA" -U postgres -A trust --no-instructions >/dev/null
    pg_ctl -D "$PGDATA" -l /tmp/pg.log -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1" start >/dev/null
    sleep 1
    psql -h 127.0.0.1 -p $PORT -U postgres -d postgres -c "ALTER USER postgres PASSWORD 'postgres';" >/dev/null
    echo "postgres up on 127.0.0.1:$PORT (user postgres / postgres)"
    ;;
  start)
    if is_running; then echo "already running"; else
      pg_ctl -D "$PGDATA" -l /tmp/pg.log -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1" start >/dev/null
      echo "started"
    fi ;;
  stop)  is_running && pg_ctl -D "$PGDATA" stop -m fast >/dev/null && echo "stopped" || echo "not running" ;;
  status) is_running && echo "RUNNING on 127.0.0.1:$PORT" || echo "STOPPED" ;;
  *) echo "usage: $0 init|start|stop|status" >&2; exit 2 ;;
esac
