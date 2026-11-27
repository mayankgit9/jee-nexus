#!/usr/bin/env python3
"""Setup probe group for mention-highlight browser E2E.
Creates A (Prober Alpha), B (Riya Sen), C (Riya) + group; A sends
"@Riya Sen hi" (mention B) and "@Riya solo" (mention C).
Leaves tag in /tmp/mhl_tag.txt.
"""
import json, urllib.request, http.cookiejar, time, sys

BASE = "https://jee-nexus-app.jee-nexus.workers.dev"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"

def client():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def req(op, path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + path, data=body, method="POST" if body else "GET")
    r.add_header("Content-Type", "application/json")
    r.add_header("User-Agent", UA)
    with op.open(r, timeout=30) as resp:
        return json.loads(resp.read().decode())

tag = str(int(time.time()))
open("/tmp/mhl_tag.txt", "w").write(tag)

A, B, C = client(), client(), client()
specs = [
    (A, f"mhl-a-{tag}@test.local", "Prober Alpha"),
    (B, f"mhl-b-{tag}@test.local", "Riya Sen"),
    (C, f"mhl-c-{tag}@test.local", "Riya"),
]
for op, email, name in specs:
    req(op, "/api/auth/signup", {"email": email, "password": "verify-pass-123", "name": name})

b_id = req(B, "/api/auth/me")["user"]["id"]
c_id = req(C, "/api/auth/me")["user"]["id"]
grp = req(A, "/api/chat/conversations", {"type": "group", "name": f"Highlight Probe {tag}", "memberIds": [b_id, c_id]})["conversationId"]

m1 = req(A, "/api/chat/messages", {"conversationId": grp, "body": "@Riya Sen hi"})
m2 = req(A, "/api/chat/messages", {"conversationId": grp, "body": "@Riya solo ping"})
ok = m1.get("mentions") == 1 and m2.get("mentions") == 1
print(json.dumps({"tag": tag, "group": grp, "m1": m1.get("mentions"), "m2": m2.get("mentions"), "ok": ok}))
sys.exit(0 if ok else 1)
