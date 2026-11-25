#!/usr/bin/env python3
"""Run SQL against the live Supabase DB via the management API.

Usage:
  python3 scripts/db_query.py "select ..."   # single inline statement
  python3 scripts/db_query.py -f file.sql    # read query from file
                                          # (NO shell escaping issues)

Read-only by convention — the API itself allows writes, so callers are
responsible for what they send.
"""
import json
import subprocess
import sys

REF = "mxfiazcjcgqzqynmsefp"  # preparena

with open("/home/z/my-project/.secrets/tokens.env") as f:
    pat = [l.split("=", 1)[1].strip() for l in f if l.startswith("SB_PAT=")][0]

if len(sys.argv) >= 3 and sys.argv[1] == "-f":
    query = open(sys.argv[2]).read()
elif len(sys.argv) == 2:
    query = sys.argv[1]
else:
    sys.exit("usage: db_query.py <sql> | db_query.py -f file.sql")

r = subprocess.run(
    ["curl", "-sS", "-m", "120", "-X", "POST",
     "-H", f"Authorization: Bearer {pat}",
     "-H", "Content-Type: application/json",
     f"https://api.supabase.com/v1/projects/{REF}/database/query",
     "-d", json.dumps({"query": query})],
    capture_output=True, text=True)

try:
    parsed = json.loads(r.stdout)
except json.JSONDecodeError:
    print("NON-JSON RESPONSE:", r.stdout[:800])
    sys.exit(1)

if isinstance(parsed, list):
    if not parsed:
        print("(0 rows)")
    for row in parsed:
        print(row)
    print(f"({len(parsed)} rows)")
else:
    print("ERROR:", json.dumps(parsed)[:800])
    sys.exit(1)
