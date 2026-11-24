#!/usr/bin/env python3
"""Live endpoint audit: hit every public API route on the deployed worker,
record status + latency + a JSON validity check. Auth'd variants use a
freshly-created test account so we exercise the real user flows."""
import json
import time
import urllib.request
import urllib.error
import uuid

BASE = "https://jee-nexus-app.jee-nexus.workers.dev"
results = []


def hit(name, method, path, body=None, headers=None, timeout=40):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent",
                   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            ms = (time.time() - t0) * 1000
            try:
                parsed = json.loads(raw)
                ok_json = True
                snippet = json.dumps(parsed)[:140]
            except Exception:
                ok_json = False
                snippet = raw[:140].decode("utf-8", "replace")
            results.append((name, r.status, f"{ms:.0f}ms", ok_json, snippet))
            return r.status, raw, dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read()
        ms = (time.time() - t0) * 1000
        try:
            parsed = json.loads(raw)
            ok_json = True
            snippet = json.dumps(parsed)[:140]
        except Exception:
            ok_json = False
            snippet = raw[:140].decode("utf-8", "replace")
        results.append((name, e.code, f"{ms:.0f}ms", ok_json, snippet))
        return e.code, raw, dict(e.headers)
    except Exception as e:
        ms = (time.time() - t0) * 1000
        results.append((name, "ERR", f"{ms:.0f}ms", False, str(e)[:140]))
        return None, b"", {}


# --- public routes ---
hit("GET /", "GET", "/")
hit("GET /api/taxonomy", "GET", "/api/taxonomy")
hit("GET /api/pyq (overview)", "GET", "/api/pyq")
hit("GET /api/pyq?year=2019", "GET", "/api/pyq?year=2019&subject=physics")
hit("GET /api/pyq?year=2019 list", "GET", "/api/pyq?year=2019&subject=chemistry&page=1&pageSize=5")

# --- create a test user and exercise authed flows ---
su = f"audit_{uuid.uuid4().hex[:10]}@test.jee-nexus.dev"
st, body, hdrs = hit("POST /api/auth/signup", "POST", "/api/auth/signup",
                     {"email": su, "password": "Audit-Pass-123!", "name": "Auditor"})
cookie = None
if st == 200:
    try:
        cookie = json.loads(body).get("user", {}).get("sessionToken")
    except Exception:
        pass
if not cookie and hdrs.get("Set-Cookie"):
    cookie = hdrs["Set-Cookie"].split(";")[0].split("=", 1)[1]
if cookie:
    auth = {"Cookie": f"session={cookie}"}
    hit("GET /api/auth/me", "GET", "/api/auth/me", headers=auth)
    hit("POST /api/questions/random", "POST", "/api/questions/random",
        {"count": 3, "subjects": ["physics"]}, headers=auth)
    hit("GET /api/bookmarks", "GET", "/api/bookmarks", headers=auth)
    hit("GET /api/stats", "GET", "/api/stats", headers=auth)
    hit("GET /api/exam/list", "GET", "/api/exam/list", headers=auth)
    hit("GET /api/reports", "GET", "/api/reports", headers=auth)
else:
    results.append(("AUTHED FLOWS", "SKIP", "-", False, "no session cookie from signup"))

# --- admin login (existing provisioned admin) ---
st, body, _ = hit("POST /api/auth/login (admin)", "POST", "/api/auth/login",
                  {"email": "admin@jee-nexus.dev", "password": "admin-pass-123"})
admin_cookie = None
if st == 200:
    try:
        j = json.loads(body)
        tok = j.get("user", {}).get("sessionToken")
        if tok:
            admin_cookie = tok
    except Exception:
        pass
if admin_cookie:
    hit("GET /api/stats (admin)", "GET", "/api/stats",
        headers={"Cookie": f"session={admin_cookie}"})
    hit("GET /api/admin/import (admin)", "GET", "/api/admin/import",
        headers={"Cookie": f"session={admin_cookie}"})

# --- bad input checks (400s expected, not 500s) ---
hit("POST /api/questions/random (no body)", "POST", "/api/questions/random", {})
hit("GET /api/pyq?year=1857", "GET", "/api/pyq?year=1857")
hit("POST /api/auth/login (bad creds)", "POST", "/api/auth/login",
    {"email": "nobody@x.dev", "password": "wrong"})

print(f"{'NAME':44} {'CODE':>4} {'LAT':>7} JSON  SNIPPET")
print("-" * 130)
for name, code, lat, okj, snip in results:
    mark = "ok" if okj else "RAW"
    print(f"{name:44} {str(code):>4} {lat:>7} {mark:4}  {snip}")
