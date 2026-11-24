#!/usr/bin/env python3
"""JEE NEXUS — apply SQL migration to the live Supabase project via management API."""
import json
import subprocess
import sys

REF = "kwavmbowgvgphaccrqlc"
SQL_FILE = sys.argv[1] if len(sys.argv) > 1 else "supabase/migrations/0001_init.sql"

with open("/home/z/my-project/.secrets/tokens.env") as f:
    pat = [l.split("=", 1)[1].strip() for l in f if l.startswith("SB_PAT=")][0]

sql = open(SQL_FILE).read()

# Split into batches on statement boundaries at top level (the API accepts multi-statement
# strings, but keep batches modest). Simple split on ";\n" is safe here (no functions w/ bodies
# except do$$ blocks which contain ; inside — keep those intact by splitting on ";\n\n" style
# boundaries). The file uses ";\n" frequently... safest: send the whole thing in a few chunks
# split at "-- ============ " comment markers which never appear inside do$$ blocks.
chunks = []
current = []
for line in sql.splitlines(keepends=True):
    current.append(line)
    if line.startswith("-- ============"):
        chunks.append("".join(current))
        current = []
if current:
    chunks.append("".join(current))

# merge do$$ enum blocks with following content safely: actually each chunk boundary is a
# comment line, and do$$ blocks end with "end $$;" before any comment — safe.
ok = 0
fail = 0
for i, chunk in enumerate(chunks):
    if not chunk.strip():
        continue
    r = subprocess.run(
        ["curl", "-sS", "-m", "60", "-X", "POST",
         "-H", f"Authorization: Bearer {pat}",
         "-H", "Content-Type: application/json",
         f"https://api.supabase.com/v1/projects/{REF}/database/query",
         "-d", json.dumps({"query": chunk})],
        capture_output=True, text=True)
    body = r.stdout.strip()
    # API returns result rows (list) on success, {"message": ...} on error
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, list):
        ok += 1
        print(f"chunk {i+1}/{len(chunks)}: OK")
    else:
        fail += 1
        print(f"chunk {i+1}/{len(chunks)}: FAIL -> {body[:300]}")

print(f"\nRESULT: {ok} ok, {fail} failed")
sys.exit(1 if fail else 0)
