import json, re, urllib.request, urllib.parse, http.cookiejar

BASE = "https://jee-nexus-app.jee-nexus.workers.dev"
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"

def req(path, data=None, method=None, label=None):
    url = BASE + path
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(url, data=body, method=method or ("POST" if body else "GET"))
    r.add_header("Content-Type", "application/json")
    r.add_header("User-Agent", UA)
    tag = label or path
    try:
        with opener.open(r, timeout=30) as resp:
            raw = resp.read().decode()
            d = json.loads(raw) if raw else {}
            size = len(raw)
            print(f"  {tag}: 200 ({size}b)")
            return d
    except urllib.error.HTTPError as e:
        print(f"  {tag}: HTTP {e.code} :: {e.read().decode()[:160]}")
        return {"_status": e.code}
    except Exception as e:
        print(f"  {tag}: ERR {e}")
        return {"_err": str(e)}

print("== anon endpoints ==")
req("/", label="home html")
req("/api/taxonomy")
req("/api/pyq")
req("/api/pyq?year=2024&subject=physics")
req("/api/pyq?q=gravitation")
req("/api/leaderboard")
req("/api/leaderboard?period=all")
req("/api/auth/me")

print("== admin login ==")
lg = req("/api/auth/login", {"email":"admin@jee-nexus.dev","password":"admin-pass-123"}, label="login")
assert "user" in lg, "login failed"

print("== authed read endpoints ==")
me = req("/api/auth/me", label="me")
stats = req("/api/stats", label="stats")
req("/api/bookmarks", label="bookmarks")
req("/api/exam/list", label="exam list")
req("/api/chat/conversations", label="chat convs")
req("/api/chat/users?q=a", label="chat users search")
req("/api/chat/search?q=hi", label="chat msg search")
lb = req("/api/leaderboard", label="leaderboard authed")

print("== spot checks ==")
if stats.get("streak") is not None:
    print("  stats.streak:", stats["streak"])
if lb.get("activeStudents") is not None:
    print("  leaderboard activeStudents:", lb["activeStudents"])
conv = req("/api/chat/conversations", label="chat convs again")
convs = conv.get("conversations") or conv.get("items") or []
print("  conversations:", len(convs))
if convs:
    cid = convs[0].get("id")
    msgs = req(f"/api/chat/messages?conversationId={urllib.parse.quote(cid)}&limit=5", label=f"chat msgs of {cid[:8]}")
    ml = msgs.get("messages") or []
    print("  first conv msgs:", len(ml))
rnd = req("/api/random?subject=physics&count=1", label="random physics")
print("  random keys:", list(rnd.keys())[:8])
