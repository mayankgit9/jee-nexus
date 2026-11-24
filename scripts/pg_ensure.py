#!/usr/bin/env python3
"""JEE NEXUS — embedded PostgreSQL bootstrap (sandbox runtime).

The sandbox has no docker/system postgres; pgserver (pip) ships self-contained
PostgreSQL binaries that run as a normal user. This script ensures a TCP
instance is up on 127.0.0.1:54329 with data in db/pgdata (persistent across
sandbox recycles; the postmaster daemon survives this script).

Usage:
  python3 scripts/pg_ensure.py            # ensure running, print DATABASE_URL
  python3 scripts/pg_ensure.py --status   # just report
"""
import os
import socket
import subprocess
import sys
from pathlib import Path

import pgserver

PGDATA = Path("/home/z/my-project/db/pgdata")
LOG = PGDATA / "log.txt"
HOST, PORT = "127.0.0.1", 54329
DB_NAME = "jee_nexus"
DB_USER, DB_PASS = "jee_app", "jee_app_local"
OUT_URL = f"postgresql://{DB_USER}:{DB_PASS}@{HOST}:{PORT}/{DB_NAME}"


def is_up() -> bool:
    s = socket.socket()
    s.settimeout(1.5)
    try:
        s.connect((HOST, PORT))
        return True
    except OSError:
        return False
    finally:
        s.close()


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def main() -> int:
    if "--status" in sys.argv:
        print("RUNNING" if is_up() else "DOWN")
        return 0

    started = False
    if not is_up():
        started = True
        PGDATA.mkdir(parents=True, exist_ok=True)

        # 1. init cluster on first run
        if not (PGDATA / "PG_VERSION").exists():
            print("initdb: creating cluster...")
            pgserver.initdb(["-U", "postgres", "-E", "UTF8"], pgdata=PGDATA)
            # trust auth for loopback TCP
            hba = PGDATA / "pg_hba.conf"
            hba.write_text(hba.read_text() +
                           f"\nhost all all {HOST}/32 trust\n")

        # 2. clear stale pid file (sandbox recycle kills processes, not files)
        pid_file = PGDATA / "postmaster.pid"
        if pid_file.exists():
            try:
                first = int(pid_file.read_text().splitlines()[0])
                if not pid_alive(first):
                    print(f"removing stale postmaster.pid (pid {first})")
                    pid_file.unlink()
            except (ValueError, IndexError):
                pid_file.unlink()

        # 3. start on TCP (direct pg_ctl call: no atexit handler -> survives)
        print("pg_ctl: starting postgres on TCP ...")
        pgserver.pg_ctl(
            ["-w", "-t", "30",
             "-o", f"-h {HOST}",
             "-o", f"-p {PORT}",
             "-o", "-c max_connections=300",
             "-l", str(LOG),
             "start"],
            pgdata=PGDATA,
        )

        if not is_up():
            print("FAILED to start; log tail:")
            print(LOG.read_text()[-2000:] if LOG.exists() else "(no log)")
            return 1

    # 4. app role + database (idempotent) — pgserver.psql is a command fn
    def sql(db: str, stmt: str) -> None:
        pgserver.psql(["-h", HOST, "-p", str(PORT), "-U", "postgres",
                       "-d", db, "-v", "ON_ERROR_STOP=0", "-c", stmt])

    sql("postgres", f"DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='{DB_USER}') THEN CREATE ROLE {DB_USER} LOGIN PASSWORD '{DB_PASS}'; ELSE ALTER ROLE {DB_USER} LOGIN PASSWORD '{DB_PASS}'; END IF; END $$;")
    r = pgserver.psql(["-h", HOST, "-p", str(PORT), "-U", "postgres",
                       "-d", "postgres", "-tAc",
                       f"SELECT 1 FROM pg_database WHERE datname='{DB_NAME}'"])
    if "1" not in str(r):
        sql("postgres", f"CREATE DATABASE {DB_NAME} OWNER {DB_USER}")

    print(f"{'STARTED' if started else 'ALREADY_RUNNING'} {OUT_URL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
