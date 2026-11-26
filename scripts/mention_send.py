#!/usr/bin/env python3
"""Login as probe user A and send a mention message into the probe group.
Usage: python3 scripts/mention_send.py <tag> <body>
"""
import json, urllib.request, http.cookiejar, sys

BASE = "https://jee-nexus-app.jee-nexus.workers.dev"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"

tag, body = sys.argv[1], sys.argv[2]
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def req(path, data=None):
    payload = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + path, data=payload, method="POST" if payload else "GET")
    r.add_header("Content-Type", "application/json")
    r.add_header("User-Agent", UA)
    with op.open(r, timeout=30) as resp:
        return json.loads(resp.read().decode())

req("/api/auth/login", {"email": f"mention-a-{tag}@test.local", "password": "verify-pass-123"})
convs = req("/api/chat/conversations")
grp = next(c["id"] for c in convs["conversations"] if c["name"] == f"Mention Probe {tag}" and c["type"] == "group")
out = req("/api/chat/messages", {"conversationId": grp, "body": body})
print(json.dumps({"conversationId": grp, "mentions": out.get("mentions"), "body": out["message"]["body"]}))
