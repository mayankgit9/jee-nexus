#!/usr/bin/env python3
"""JEE NEXUS — run SQL on the live Supabase project (reads from stdin or file arg)."""
import json
import subprocess
import sys

REF = "mxfiazcjcgqzqynmsefp"  # preparena (ap-south-1)

with open("/home/z/my-project/.secrets/tokens.env") as f:
    pat = [l.split("=", 1)[1].strip() for l in f if l.startswith("SB_PAT=")][0]

sql = open(sys.argv[1]).read() if len(sys.argv) > 1 else sys.stdin.read()

r = subprocess.run(
    ["curl", "-sS", "-m", "60", "-X", "POST",
     "-H", f"Authorization: Bearer {pat}",
     "-H", "Content-Type: application/json",
     f"https://api.supabase.com/v1/projects/{REF}/database/query",
     "-d", json.dumps({"query": sql})],
    capture_output=True, text=True)
print(r.stdout)
