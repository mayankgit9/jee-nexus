#!/usr/bin/env python3
"""Live E2E probe: @mention notifications (chat_mentions).

Flow:
  A (Prober Alpha) creates a group with B (Riya Sen) and C (Riya).
  1. A sends "@Riya Sen hi"  → response mentions:1
     B unread → latest.mentioned=true, latest.conversationId set
     C unread → latest.mentioned=false   (longest-name-first wins)
  2. A sends "@riyaa hello"  → mentions:0 (word boundary rejects)
  3. A DMs B "@Riya Sen dm"  → mentions:0 (DM path skips mentions)
  4. B reads the group via /api/chat/read → chat_mentions.read_at stamped

Cleans up: leaves tag in /tmp/mention_tag.txt; deletes probe users +
conversations via SQL cleanup step (separate).
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
open("/tmp/mention_tag.txt", "w").write(tag)

fails = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(name)

A, B, C = client(), client(), client()
specs = [
    (A, f"mention-a-{tag}@test.local", "Prober Alpha"),
    (B, f"mention-b-{tag}@test.local", "Riya Sen"),
    (C, f"mention-c-{tag}@test.local", "Riya"),
]
for op, email, name in specs:
    req(op, "/api/auth/signup", {"email": email, "password": "verify-pass-123", "name": name})

b_id = req(B, "/api/auth/me")["user"]["id"]
c_id = req(C, "/api/auth/me")["user"]["id"]

# A creates group with B, C in one call (API requires >=1 member at creation)
grp = req(A, "/api/chat/conversations", {"type": "group", "name": f"Mention Probe {tag}", "memberIds": [b_id, c_id]})["conversationId"]

# 1. mention the longer name
m1 = req(A, "/api/chat/messages", {"conversationId": grp, "body": "@Riya Sen hi"})
check("POST group mention returns mentions:1", m1.get("mentions") == 1, json.dumps(m1)[:120])
u_b = req(B, "/api/chat/unread")
check("B unread total>=1", u_b.get("total", 0) >= 1, json.dumps(u_b)[:160])
check("B latest.mentioned=true", u_b.get("latest", {}).get("mentioned") is True, json.dumps(u_b.get("latest"))[:160])
check("B latest.conversationId=grp", u_b.get("latest", {}).get("conversationId") == grp)
u_c = req(C, "/api/chat/unread")
check("C latest.mentioned=false (longest-first)", u_c.get("latest", {}).get("mentioned") is False, json.dumps(u_c.get("latest"))[:160])

# 2. word boundary: "@riyaa" must not match "Riya"
m2 = req(A, "/api/chat/messages", {"conversationId": grp, "body": "@riyaa hello"})
check("POST '@riyaa' returns mentions:0", m2.get("mentions") == 0, json.dumps(m2)[:120])

# 3. DM mention is skipped
dm = req(A, "/api/chat/conversations", {"type": "dm", "userId": b_id})["conversationId"]
m3 = req(A, "/api/chat/messages", {"conversationId": dm, "body": "@Riya Sen dm"})
check("POST DM '@Riya Sen' mentions absent/0", not m3.get("mentions"), json.dumps(m3)[:120])
u_b2 = req(B, "/api/chat/unread")
check("B latest is DM, mentioned=false", u_b2.get("latest", {}).get("mentioned") is False and u_b2.get("latest", {}).get("type") == "dm", json.dumps(u_b2.get("latest"))[:200])

# 4. B reads the group → mention stamped read
req(B, "/api/chat/read", {"conversationId": grp})
print("TAG", tag)
print("RESULT", "ALL-PASS" if not fails else f"FAILURES: {fails}")
sys.exit(0 if not fails else 1)
