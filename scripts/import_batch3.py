#!/usr/bin/env python3
"""JEE NEXUS — import batch3 through the REAL admin import pipeline
(POST /api/admin/import), then move the new questions from 'imported' to
'needs_review' (honest editorial state; never auto-verified).
Runs against the local dev server, which is connected to live Supabase PG.

BLOCKED NOTE (2026-11-23): the live DB credentials were lost with the sandbox
reset — run this once the DATABASE_URL env / dev server is back on live
Supabase. Credentials can be overridden via ADMIN_EMAIL / ADMIN_PASSWORD env.
Prerequisite: `python3 scripts/verify_seed_batch3.py` must pass (it does)."""
import glob
import json
import os
import sys
import urllib.request
import http.client

BASE = "http://localhost:3000"
JAR = "/tmp/jn_batch3_admin_jar.txt"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@jee-nexus.dev")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin-pass-123")

def call(method, path, body=None, auth=True):
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
        with urllib.request.urlopen(req, data=data, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

# 1. login as the whitelisted admin (httpOnly cookie needs the raw header path)
conn = http.client.HTTPConnection("localhost", 3000)
conn.request("POST", "/api/auth/login", json.dumps({"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}),
             {"Content-Type": "application/json"})
resp = conn.getresponse()
body = json.loads(resp.read().decode() or "{}")
if resp.status != 200:
    print("LOGIN FAILED", resp.status, body); sys.exit(1)
print("login ok: role =", body.get("user", {}).get("role"))
setc = resp.getheader("Set-Cookie") or ""
token = setc.split("jee_nexus_session=")[-1].split(";")[0] if "jee_nexus_session=" in setc else ""
open(JAR, "w").write(token)
status, me = call("GET", "/api/auth/me")
if status != 200 or me.get("user", {}).get("role") != "admin":
    print("AUTH FAILED", status, me); sys.exit(1)
print("admin session verified")

# 2. load batch3 questions
questions = []
for fp in sorted(glob.glob("data/questions/batch3_*.json")):
    questions.extend(json.load(open(fp)))
print(f"importing {len(questions)} batch3 questions through the real pipeline...")

status, r = call("POST", "/api/admin/import", {"questions": questions})
print("import response:", status, {k: r.get(k) for k in ("inserted", "skippedDuplicate", "rejected")})
print("errors:", r.get("errors")[:3] if r.get("errors") else "none")
if status != 200 or r.get("rejected"):
    sys.exit(1)

# 3. move each new question imported -> needs_review (honest editorial state)
status, r = call("GET", "/api/admin/questions?status=imported&page=1")
moved = 0
total_pages = r.get("pageCount", 1)
for page in range(1, total_pages + 1):
    status, r = call("GET", f"/api/admin/questions?status=imported&page={page}")
    for q in r.get("questions", []):
        st, _ = call("PATCH", "/api/admin/questions", {"id": q["id"], "verificationStatus": "needs_review"})
        if st == 200:
            moved += 1
        else:
            print("PATCH failed for", q["publicId"], st)
print(f"moved to needs_review: {moved}")

# 4. verify final state
status, r = call("GET", "/api/admin/stats")
print("pipeline counts:", r.get("pipeline"))
sys.exit(0 if moved == len(questions) else 1)
