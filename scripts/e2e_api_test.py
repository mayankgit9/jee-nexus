#!/usr/bin/env python3
"""JEE NEXUS — API E2E test (run against dev server on :3000)."""
import json
import subprocess
import sys

BASE = "http://localhost:3000"
JAR = "/tmp/jn_e2e_jar.txt"

passed = 0
failed = 0

def call(method, path, body=None, use_jar=True, jar=JAR):
    cmd = ["curl", "-sS", "-m", "15", "-X", method, f"{BASE}{path}", "-H", "Content-Type: application/json"]
    if use_jar:
        cmd += ["-b", jar, "-c", jar]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(r.stdout) if r.stdout.strip() else {}

def check(name, cond, extra=""):
    global passed, failed
    print(f"{'PASS' if cond else 'FAIL'}  {name} {extra}")
    passed += 1 if cond else 0
    failed += 0 if cond else 1

# --- auth flow ---
import os
if os.path.exists(JAR):
    os.remove(JAR)
email = "e2e-runner@jee-nexus.dev"
r = call("POST", "/api/auth/signup", {"email": email, "password": "e2e-test-pass-123", "name": "E2E"})
check("signup returns user", "user" in r and r["user"]["email"] == email)

r = call("GET", "/api/auth/me")
check("session cookie authenticates /me", r.get("user", {}).get("email") == email)

# --- random selection ---
r = call("POST", "/api/questions/random", {"subject": "mathematics", "count": 5}, use_jar=False)
qs = r.get("questions", [])
check("random maths returns up to 5 questions", len(qs) == 5, f"got {len(qs)}")
check("questions carry no answer data", all("correctOptions" not in q and "isCorrect" not in str(q["options"]) for q in qs))

# repeat avoidance: same filters should avoid previously served when excluded
ids1 = {q["id"] for q in call("POST", "/api/questions/random", {"subject": "chemistry", "count": 5})["questions"]}
ids2 = {q["id"] for q in call("POST", "/api/questions/random", {"subject": "chemistry", "count": 5, "excludeQuestionIds": list(ids1)})["questions"]}
check("excludeQuestionIds respected", not (ids1 & ids2), f"overlap={len(ids1 & ids2)}")

# --- submit: correct numerical ---
r = call("POST", "/api/questions/random", {"subject": "physics", "count": 10, "includeAttempted": True})
nums = [q for q in r["questions"] if q["type"] == "numerical"]
target = None
for q in nums:
    if "drift" in q["text"].lower():
        target = (q, "3.47")
    elif "swimmer" in q["text"].lower():
        target = (q, "12")
if target:
    q, ans = target
    r = call("POST", "/api/questions/submit", {"questionId": q["id"], "numericalValue": ans, "timeSpentSeconds": 35})
    res = r.get("result", {})
    check("correct numerical graded True", res.get("isCorrect") is True, f"({q['publicId']})")
    check("solution returned with body", bool(res.get("solution", {}).get("body")))
    # wrong answer
    r = call("POST", "/api/questions/submit", {"questionId": q["id"], "numericalValue": "999"})
    check("wrong numerical graded False", r.get("result", {}).get("isCorrect") is False)
else:
    print("SKIP  no numerical physics question served")

# --- submit: correct MCQ ---
r = call("POST", "/api/questions/random", {"subject": "mathematics", "count": 10, "includeAttempted": True, "types": ["mcq_single"]})
mcqs = [q for q in r["questions"] if q["type"] == "mcq_single"]
if mcqs:
    q = mcqs[0]
    r = call("POST", "/api/questions/submit", {"questionId": q["id"], "selectedOptions": [3]})  # MAT-004 answer is option 3
    check("mcq submit returns graded result + solution", "result" in r and r["result"].get("solution") is not None, f"({q['publicId']})")

# --- bookmark toggle ---
qid = None
r = call("POST", "/api/questions/random", {"count": 1})
if r["questions"]:
    qid = r["questions"][0]["id"]
    r2 = call("POST", "/api/bookmarks", {"questionId": qid})
    check("bookmark toggles on", r2.get("bookmarked") is True)
    r3 = call("GET", "/api/bookmarks")
    check("bookmark list contains question", any(b["question"]["id"] == qid for b in r3.get("bookmarks", [])))
    r4 = call("POST", "/api/bookmarks", {"questionId": qid})
    check("bookmark toggles off", r4.get("bookmarked") is False)

# --- report ---
if qid:
    r = call("POST", "/api/reports", {"questionId": qid, "reason": "typo", "details": "e2e test report"})
    check("report accepted", r.get("ok") is True)

# --- stats reflect attempts ---
r = call("GET", "/api/stats")
st = r.get("stats", {})
check("stats show attempts>0", st.get("totalAttempts", 0) > 0, f"attempts={st.get('totalAttempts')}")
check("stats subjects present", len(st.get("subjects", [])) > 0)

# --- PYQ year overview + drill down ---
r = call("GET", "/api/pyq", use_jar=False)
years = r.get("years", [])
check("pyq year overview lists years", len(years) > 0, f"years={[y['year'] for y in years]}")
if years:
    y = years[0]["year"]
    r = call("GET", f"/api/pyq?year={y}", use_jar=False)
    check("pyq year -> subject/chapter breakdown", len(r.get("subjects", [])) > 0)
    sk = r["subjects"][0]["key"]
    r = call("GET", f"/api/pyq?year={y}&subject={sk}", use_jar=False)
    check("pyq subject -> question list", r.get("total", 0) > 0 and len(r.get("questions", [])) > 0)

# --- auth: logout kills session ---
call("POST", "/api/auth/logout")
r = call("GET", "/api/auth/me")
check("logout invalidates session", r.get("user") is None)

# --- security: RLS-equivalent — protected routes reject anonymous ---
r = subprocess.run(["curl", "-sS", "-m", "15", "-o", "/dev/null", "-w", "%{http_code}", f"{BASE}/api/stats"], capture_output=True, text=True).stdout
check("stats requires auth (401)", r == "401")
r = subprocess.run(["curl", "-sS", "-m", "15", "-o", "/dev/null", "-w", "%{http_code}", f"{BASE}/api/bookmarks"], capture_output=True, text=True).stdout
check("bookmarks requires auth (401)", r == "401")

# --- login works after logout ---
r = call("POST", "/api/auth/login", {"email": email, "password": "e2e-test-pass-123"})
check("login after logout", r.get("user", {}).get("email") == email)
r = call("POST", "/api/auth/login", {"email": email, "password": "wrong-password"})
check("wrong password rejected", "error" in r)

print(f"\nRESULT: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
