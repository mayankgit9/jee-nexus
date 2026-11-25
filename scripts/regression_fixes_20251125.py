#!/usr/bin/env python3
"""Regression tests for the 2026-11-25 bug-hunt fixes:
1. /api/pyq invalid enum filters + page -> 400 (was 500)
2. /api/questions/random garbage count/enum -> 200 graceful (was 500)
3. /api/exam/result on an in_progress attempt -> 409 (answer-leak fix)
4. random selection spans multiple years (pool-bias fix: take:500 -> full pool)
Run against a dev server on :3000 with the seeded local DB.
"""
import json
import subprocess
import sys
import urllib.request
from collections import Counter

BASE = "http://localhost:3000"
JAR = "/tmp/jn_reg_jar.txt"
passed = failed = 0


def call(method, path, body=None, use_jar=True):
    cmd = ["curl", "-sS", "-m", "30", "-X", method, f"{BASE}{path}",
           "-H", "Content-Type: application/json"]
    if use_jar:
        cmd += ["-b", JAR, "-c", JAR]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(r.stdout) if r.stdout.strip() else {}


def check(name, cond, extra=""):
    global passed, failed
    print(f"{'PASS' if cond else 'FAIL'}  {name} {extra}")
    passed += 1 if cond else 0
    failed += 0 if cond else 1


# --- 1. pyq strict validation ---
for q, label in [
    ("year=2023&subject=physics&difficulty=zzz", "pyq invalid difficulty -> 400"),
    ("year=2023&subject=physics&type=xyz", "pyq invalid type -> 400"),
    ("year=2023&subject=physics&page=abc", "pyq NaN page -> 400"),
    ("year=2023&subject=physics&page=0", "pyq page 0 -> 400"),
]:
    r = call("GET", f"/api/pyq?{q}", use_jar=False)
    check(label, r.get("error") in ("Invalid difficulty filter", "Invalid type filter", "Invalid page"), str(r)[:80])

r = call("GET", "/api/pyq?year=2023&subject=physics&difficulty=hard", use_jar=False)
check("pyq valid difficulty still 200", "questions" in r, f"total={r.get('total')}")

# --- 2. random graceful degradation ---
r = call("POST", "/api/questions/random", {"count": "abc"}, use_jar=False)
check("random count='abc' -> 1 question", len(r.get("questions", [])) == 1, str(r)[:80])
r = call("POST", "/api/questions/random", {"difficulties": ["zzz"], "count": 3}, use_jar=False)
check("random invalid enum dropped -> results", len(r.get("questions", [])) == 3, str(r)[:80])
r = call("POST", "/api/questions/random", {"difficulties": ["zzz", "hard"], "count": 3}, use_jar=False)
check("random mixed enums keeps valid ones", len(r.get("questions", [])) == 3, str(r)[:80])

# --- 4. pool bias: 120 random questions should span >= 4 years ---
seen = Counter()
for _ in range(12):
    r = call("POST", "/api/questions/random", {"count": 10}, use_jar=False)
    for q in r.get("questions", []):
        seen[q.get("sourceYear")] += 1
years = [y for y in seen if y]
check("random spans >=4 distinct years (no pool bias)", len(years) >= 4, f"years={sorted(years)} spread={dict(seen)}")

# --- 3. exam result anti-leak ---
email = f"reg-{sys.modules['time'] and __import__('time').time()}@test.dev"
r = call("POST", "/api/auth/signup", {"email": email, "password": "reg-test-pass-123", "name": "R"})
check("regression signup ok", "user" in r, str(r)[:80])

r = call("POST", "/api/exam/list", {"kind": "full_length"})  # auth'd generation
exam_id = r.get("examId")
if not exam_id:
    exams = call("GET", "/api/exam/list")["exams"]
    full = [e for e in exams if e["kind"] == "full_length"]
    if not full:
        r = call("POST", "/api/exam/list", {"kind": "full_length"})
        exam_id = r.get("examId")
    else:
        exam_id = full[0]["id"]
r = call("POST", "/api/exam/start", {"examId": exam_id})
attempt_id = r.get("attemptId")
check("exam started", bool(attempt_id), str(r)[:80])

r = call("GET", f"/api/exam/result?attemptId={attempt_id}")
check("result for in_progress -> 409 error", r.get("error") and "in progress" in r.get("error", ""), str(r)[:100])

# answer everything correctly via start payload? No — just submit to unlock, then verify review works
r = call("POST", "/api/exam/submit", {"attemptId": attempt_id})
check("exam submit ok", r.get("status") in ("submitted", "expired"), str(r)[:100])
r = call("GET", f"/api/exam/result?attemptId={attempt_id}")
check("result after submit -> review visible", "review" in r and len(r["review"]) > 0, f"review={len(r.get('review', []))}")

print(f"\nRESULT: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
