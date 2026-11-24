#!/usr/bin/env python3
"""Quick SQL query helper against the sandbox embedded Postgres."""
import sys
import pgserver

if len(sys.argv) < 2:
    print("usage: scripts/q.py \"SELECT ...\"")
    sys.exit(2)
try:
    out = pgserver.psql(
        ["-h", "127.0.0.1", "-p", "54329", "-U", "postgres",
         "-d", "jee_nexus", "-tAc", sys.argv[1]])
    print(out)
except Exception as e:  # noqa: BLE001
    print("SQL ERROR:", str(e)[:500])
    sys.exit(1)
