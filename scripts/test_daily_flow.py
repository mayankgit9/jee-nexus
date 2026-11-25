"""Daily challenge flow e2e (run against dev server on :3000)."""
import json, subprocess, random, string

BASE = "http://localhost:3000"

def req(path, data=None, method=None, cookie=None):
    cmd = ["curl", "-sS", "-m", "15", "-X", method or ("POST" if data is not None else "GET"),
           f"{BASE}{path}", "-H", "Content-Type: application/json"]
    if cookie: cmd += ["-H", f"Cookie: {cookie}"]
    if data is not None: cmd += ["-d", json.dumps(data)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(r.stdout) if r.stdout.strip() else {}

def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))
    return cond

suffix = "".join(random.choices(string.ascii_lowercase, k=8))
email = f"daily-qa-{suffix}@jee-nexus.dev"
ok = True

# signup
r = req("/api/auth/signup", {"email": email, "password": "daily-pass-123", "name": "Daily QA"})
cookie = r.get("setCookie") or ""
# signup route returns cookie via header, curl -sS doesn't capture; use /api/auth/login to get cookie header
r2 = subprocess.run(["curl", "-sS", "-i", "-X", "POST", f"{BASE}/api/auth/login",
                     "-H", "Content-Type: application/json",
                     "-d", json.dumps({"email": email, "password": "daily-pass-123"})],
                    capture_output=True, text=True)
for line in r2.stdout.splitlines():
    if line.lower().startswith("set-cookie:"):
        cookie = line.split(":", 1)[1].strip().split(";")[0]
ok &= check("login returns session cookie", bool(cookie))

# daily before answering
d1 = req("/api/daily")
ok &= check("daily has question", d1.get("question") is not None, json.dumps(d1)[:120])
ok &= check("daily answered null before submit", d1.get("answered") is None)
ok &= check("no solution shipped before submit", "solution" not in d1)
qid = d1["question"]["id"]

# deterministic pick
d1b = req("/api/daily")
ok &= check("daily pick deterministic", d1b["question"]["id"] == qid)

# submit a deliberately wrong MCQ answer (option 999 -> filtered; use option 0 then check)
sub = req("/api/questions/submit", {"questionId": qid, "selectedOptions": [0], "timeSpentSeconds": 5}, cookie=cookie)
ok &= check("submit graded", "result" in sub, json.dumps(sub)[:150])

# daily after answering
d2 = req("/api/daily", cookie=cookie)
ok &= check("answered recorded after submit", d2.get("answered") is not None, json.dumps(d2)[:150])
ok &= check("answered has isCorrect", isinstance(d2.get("answered", {}).get("isCorrect"), bool))
ok &= check("solution ships after submit", "solution" in d2 and bool(d2["solution"]))
ok &= check("attemptedCount >= 1", d2.get("attemptedCount", 0) >= 1, str(d2.get("attemptedCount")))

# anon daily: answered stays null even after submit above
d3 = req("/api/daily")
ok &= check("anon still sees answered null", d3.get("answered") is None)
ok &= check("anon gets no solution", "solution" not in d3)

# answer edge: solution must not leak for anon ever
print(f"\nRESULT: {sum(1 for _ in [])}")  # summary below
print("ALL PASS" if ok else "SOME FAILED")
