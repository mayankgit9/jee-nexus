#!/usr/bin/env python3
"""JEE NEXUS — import batch2 through the REAL admin import pipeline
(POST /api/admin/import), then move the new questions from 'imported' to
'needs_review' (honest editorial state; never auto-verified).
Runs against the local dev server, which is connected to live Supabase PG."""
import glob
import json
import sys
import urllib.request

BASE = "http://localhost:3000"
JAR = "/tmp/jn_batch2_admin_jar.txt"

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

# 1. login as the whitelisted admin
status, r = call("POST", "/api/auth/login", {"email": "admin@jee-nexus.dev", "password": "admin-pass-123"}, auth=False)
if status != 200:
    print("LOGIN FAILED", status, r); sys.exit(1)
print("login ok: role =", r.get("user", {}).get("role"))
token = r.get("token") or r.get("sessionToken") or r.get("cookie")
# capture set-cookie style token from response if present, else read from /api/auth/me flow
if not token:
    # login sets httpOnly cookie; urllib won't expose it. Use the raw header approach:
    import http.client
    conn = http.client.HTTPConnection("localhost", 3000)
    conn.request("POST", "/api/auth/login", json.dumps({"email": "admin@jee-nexus.dev", "password": "admin-pass-123"}), {"Content-Type": "application/json"})
    resp = conn.getresponse()
    resp.read()
    setc = resp.getheader("Set-Cookie") or ""
    token = setc.split("jee_nexus_session=")[-1].split(";")[0] if "jee_nexus_session=" in setc else ""
open(JAR, "w").write(token)
status, me = call("GET", "/api/auth/me")
if status != 200 or me.get("user", {}).get("role") != "admin":
    print("AUTH FAILED", status, me); sys.exit(1)
print("admin session verified")

# 2. load batch2 questions
questions = []
for fp in sorted(glob.glob("data/questions/batch2_*.json")):
    questions.extend(json.load(open(fp)))
print(f"importing {len(questions)} batch2 questions through the real pipeline...")

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
