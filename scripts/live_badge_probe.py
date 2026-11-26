import json, urllib.request, http.cookiejar, time

BASE = "https://jee-nexus-app.jee-nexus.workers.dev"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"

def client():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def req(op, path, data=None, method=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + path, data=body, method=method or ("POST" if body else "GET"))
    r.add_header("Content-Type", "application/json")
    r.add_header("User-Agent", UA)
    with op.open(r, timeout=30) as resp:
        return json.loads(resp.read().decode())

tag = str(int(time.time()))
tmp = client()
try:
    req(tmp, "/api/auth/signup", {"email": f"badge-{tag}@test.local", "password": "verify-pass-123", "name": "Badge Probe"})
except Exception:
    req(tmp, "/api/auth/login", {"email": f"badge-{tag}@test.local", "password": "verify-pass-123"})
users = req(tmp, "/api/chat/users?q=admin@jee-nexus.dev")
conv = req(tmp, "/api/chat/conversations", {"type": "dm", "userId": users["users"][0]["id"]})
req(tmp, "/api/chat/messages", {"conversationId": conv["conversationId"], "body": f"badge probe {tag}"})
print("DM sent, tag:", tag)
open("/tmp/badge_tag.txt", "w").write(json.dumps({"tag": tag, "conv": conv["conversationId"], "email": f"badge-{tag}@test.local"}))
