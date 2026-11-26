import json, urllib.request, http.cookiejar, time

BASE = "https://jee-nexus-app.jee-nexus.workers.dev"

def client():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def req(op, path, data=None, method=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + path, data=body, method=method or ("POST" if body else "GET"))
    r.add_header("Content-Type", "application/json")
    r.add_header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36")
    with op.open(r, timeout=30) as resp:
        return json.loads(resp.read().decode())

admin = client()
me = req(admin, "/api/auth/login", {"email": "admin@jee-nexus.dev", "password": "admin-pass-123"})
print("admin login:", "OK" if "user" in me else "FAIL")

u = req(admin, "/api/chat/unread")
print("admin unread:", u["total"], "| latest:", (u.get("latest") or {}).get("body", "-")[:40])

# history endpoint — all + each filter + pagination shape
for f in ["all", "practice", "exam", "correct", "incorrect", "skipped"]:
    h = req(admin, f"/api/stats/history?filter={f}&pageSize=20")
    print(f"history[{f:9}] total={h['total']:4} page1={len(h['items']):2} hasMore={h['hasMore']}")
h2 = req(admin, "/api/stats/history?filter=all&page=2&pageSize=10")
print("history page2 ids overlap page1:", bool(set(x["id"] for x in h2["items"]) & set(x["id"] for x in req(admin, '/api/stats/history?filter=all&page=1&pageSize=10')['items'])))

# DM round-trip: fresh user messages admin
tag = str(int(time.time()))
tmp = client()
tag2 = tag
try:
    su = req(tmp, "/api/auth/signup", {"email": f"loop-verify-{tag}@test.local", "password": "verify-pass-123", "name": "Loop Verify"})
    print("temp signup: OK")
except Exception as e:
    print("temp signup existed -> login:", e)
    su = req(tmp, "/api/auth/login", {"email": f"loop-verify-{tag}@test.local", "password": "verify-pass-123"})
users = req(tmp, "/api/chat/users?q=admin@jee-nexus.dev")
target = users["users"][0] if users.get("users") else None
print("found admin in dir:", bool(target))
conv = req(tmp, "/api/chat/conversations", {"type": "dm", "userId": target["id"]})
msg = req(tmp, "/api/chat/messages", {"conversationId": conv["conversationId"], "body": f"loop verification ping {tag}"})
print("DM sent:", "OK" if msg.get("message", {}).get("body", "").endswith(tag) else json.dumps(msg)[:120])

u2 = req(admin, "/api/chat/unread")
print("admin unread after DM:", u2["total"], "| latest:", (u2.get("latest") or {}).get("body", "-"))
assert u2["total"] >= 1 and (u2.get("latest") or {}).get("body", "").endswith(tag), "badge flow FAILED"

# admin marks read → unread drops to 0
req(admin, "/api/chat/read", {"conversationId": conv["conversationId"]})
u3 = req(admin, "/api/chat/unread")
print("admin unread after mark-read:", u3["total"])
assert u3["total"] == 0, "mark-read did not clear"

print("ALL LIVE VERIFICATIONS PASSED")
