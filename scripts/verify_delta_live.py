import json, re, urllib.request, urllib.parse, sys

BASE = "https://jee-nexus-app.jee-nexus.workers.dev"
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())

def req(path, data=None, method=None):
    url = BASE + path
    body = None
    if data is not None:
        body = json.dumps(data).encode()
    r = urllib.request.Request(url, data=body, method=method or ("POST" if body else "GET"))
    r.add_header("Content-Type", "application/json")
    r.add_header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36")
    try:
        with opener.open(r, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"_status": e.code, "_body": e.read().decode()[:200]}

# login admin
lg = req("/api/auth/login", {"email": "admin@jee-nexus.dev", "password": "admin-pass-123"})
print("login:", lg.get("ok", lg.get("_status", "?")))

pat = re.compile(r"\\Delta[A-Za-z]")
bad = 0
checked = 0
for year in (2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019):
    for subj in ("chemistry", "physics", "mathematics"):
        q = f"/api/pyq?year={year}&subject={subj}&limit=3"
        d = req(q)
        items = d.get("questions") or d.get("items") or []
        for it in items[:2]:
            qid = it.get("id") or it.get("publicId")
            if not qid: continue
            det = req(f"/api/questions/detail?publicId={urllib.parse.quote(str(qid))}")
            blob = json.dumps(det)
            checked += 1
            for m in pat.finditer(blob):
                bad += 1
                print(f"ARTIFACT {year}/{subj} qid={qid}: ...{blob[max(0,m.start()-40):m.end()+40]}...")
print(f"checked={checked} artifacts={bad}")
