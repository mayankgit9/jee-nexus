#!/usr/bin/env python3
"""JEE NEXUS — import ALL real PYQ batches (data/questions/pyq*.json) through
the real admin import pipeline (POST /api/admin/import), then move the new
'PYQ-*' questions from 'imported' to 'needs_review' (honest editorial state).

Works against any target the dev server is connected to:
  - local SQLite (sandbox preview / validation):  default, no env needed
  - live Supabase production (CI workflow):        DATABASE_URL + ADMIN_EMAILS env

Idempotent: duplicate publicIds are skipped server-side, so re-runs never
double-insert. Env overrides: ADMIN_EMAIL, ADMIN_PASSWORD, BASE,
IMPORT_BATCH_SIZE (default 50), SKIP_STATUS_MOVE=1 to only import.
"""
import glob
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import http.client

BASE = os.environ.get("BASE", "http://localhost:3000")
JAR = "/tmp/jn_pyq_admin_jar.txt"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@jee-nexus.dev")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin-pass-123")
BATCH_SIZE = int(os.environ.get("IMPORT_BATCH_SIZE", "50"))
SKIP_STATUS_MOVE = os.environ.get("SKIP_STATUS_MOVE", "") == "1"

def call(method, path, body=None, auth=True, timeout=120):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if auth:
        try:
            token = open(JAR).read().strip()
            req.add_header("Cookie", f"jee_nexus_session={token}")
        except FileNotFoundError:
            pass
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}

# 1. admin login (httpOnly cookie needs the raw header path)
conn = http.client.HTTPConnection("localhost", 3000)
if BASE != "http://localhost:3000":
    u = urllib.parse.urlparse(BASE)
    conn = http.client.HTTPConnection(u.hostname, u.port or 80)
conn.request("POST", "/api/auth/login",
             json.dumps({"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}),
             {"Content-Type": "application/json"})
resp = conn.getresponse()
body = json.loads(resp.read().decode() or "{}")
if resp.status != 200:
    print("LOGIN FAILED", resp.status, body)
    sys.exit(1)
print("login ok: role =", body.get("user", {}).get("role"))
setc = resp.getheader("Set-Cookie") or ""
token = setc.split("jee_nexus_session=")[-1].split(";")[0] if "jee_nexus_session=" in setc else ""
open(JAR, "w").write(token)
status, me = call("GET", "/api/auth/me")
if status != 200 or me.get("user", {}).get("role") != "admin":
    print("AUTH FAILED", status, me)
    sys.exit(1)
print("admin session verified")

# 2. load every pyq batch (sorted for deterministic order)
files = sorted(glob.glob("data/questions/pyq*.json"))
questions = []
for fp in files:
    questions.extend(json.load(open(fp)))
print(f"importing {len(questions)} PYQ questions from {len(files)} batch files "
      f"(chunked x{BATCH_SIZE})...")

inserted = skipped = rejected = 0
first_errors = []
t0 = time.time()
for i in range(0, len(questions), BATCH_SIZE):
    chunk = questions[i:i + BATCH_SIZE]
    # retry transient 5xx (pooler hiccups / connection storms) so a single
    # bad moment can't kill a multi-hour run; deterministic failures still
    # exit after the retries
    status, r = 502, {}
    for attempt in range(3):
        status, r = call("POST", "/api/admin/import", {"questions": chunk}, timeout=300)
        if status == 200:
            break
        print(f"  chunk {i//BATCH_SIZE + 1} attempt {attempt + 1} -> {status}, retrying in 20s...", flush=True)
        time.sleep(20)
    if status != 200:
        print(f"CHUNK {i//BATCH_SIZE + 1} FAILED: {status}", {k: r.get(k) for k in ("inserted", "skippedDuplicate", "rejected")})
        for e in (r.get("errors") or [])[:5]:
            print("  err:", str(e)[:200])
        sys.exit(1)
    inserted += r.get("inserted", 0)
    skipped += r.get("skippedDuplicate", 0)
    rejected += r.get("rejected", 0)
    for e in (r.get("errors") or [])[:3]:
        first_errors.append(str(e)[:200])
    done = min(i + BATCH_SIZE, len(questions))
    print(f"  chunk {i//BATCH_SIZE + 1}: cumulative {done}/{len(questions)} "
          f"(inserted={inserted}, skipped={skipped}, rejected={rejected}) "
          f"[{int(time.time()-t0)}s]", flush=True)

print(f"import done: inserted={inserted} skipped={skipped} rejected={rejected}")
if first_errors:
    print("sample errors:")
    for e in first_errors[:5]:
        print("  ", e)
if rejected:
    print("FATAL: rejected > 0 — fix data before retrying")
    sys.exit(1)

if SKIP_STATUS_MOVE:
    print("SKIP_STATUS_MOVE=1 — leaving status='imported' as-is")
    sys.exit(0)

# 3. move new PYQ questions imported -> needs_review (only PYQ-* ids)
status, r = call("GET", "/api/admin/questions?status=imported&page=1")
total_pages = r.get("pageCount", 1)
moved = 0
for page in range(1, total_pages + 1):
    status, r = call("GET", f"/api/admin/questions?status=imported&page={page}")
    for q in r.get("questions", []):
        if not str(q.get("publicId", "")).startswith("PYQ-"):
            continue
        st, _ = call("PATCH", "/api/admin/questions",
                     {"id": q["id"], "verificationStatus": "needs_review"})
        if st == 200:
            moved += 1
        else:
            print("PATCH failed for", q.get("publicId"), st)
print(f"moved to needs_review: {moved}")

# 4. final state
status, r = call("GET", "/api/admin/stats")
print("pipeline counts:", r.get("pipeline"))
sys.exit(0 if (rejected == 0) else 1)
