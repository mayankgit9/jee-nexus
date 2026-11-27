#!/usr/bin/env python3
"""Live E2E probe for the per-mock analytics (backlog ②).

signup probe user → create custom exam → start → answer all → submit →
GET /api/stats → assert mocks[0] shape + math → cleanup user.
"""
import json, time, urllib.request, http.cookiejar

BASE = "https://jee-nexus-app.jee-nexus.workers.dev"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
suffix = str(int(time.time() * 1000))
EMAIL = f"pw-mock-{suffix}@jee-nexus.dev"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def call(path, data=None, method=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(BASE + path, data=body, method=method or ("POST" if body else "GET"),
                                 headers={"Content-Type": "application/json", "User-Agent": UA})
    try:
        with opener.open(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}

# 1. signup
code, d = call("/api/auth/signup", {"name": "Mock Probe", "email": EMAIL, "password": "pw-mock-pass-123"})
assert code == 200, f"signup failed: {code} {d}"
print("1. signup ok")

# 2. create a small custom exam (2 physics questions, 5 min)
code, d = call("/api/exam/list", {"title": f"Probe Mock {suffix}", "kind": "custom",
                                  "subjectKey": "physics", "questionsPerSubject": 2, "durationMinutes": 5})
assert code == 200, f"exam create failed: {code} {d}"
exam_id = d["examId"]
print(f"2. exam created {exam_id} warnings={d.get('warnings')}")

# 3. start attempt
code, d = call("/api/exam/start", {"examId": exam_id})
assert code == 200, f"start failed: {code} {d}"
attempt_id = d["attemptId"]
questions = d["questions"] if "questions" in d else d.get("exam", {}).get("questions", [])
print(f"3. attempt {attempt_id} questions={len(questions)}")
assert len(questions) >= 1

# 4. answer all questions with option 0 (answer API keys on examQuestionId)
answered = 0
for q in questions:
    qid = q["examQuestionId"] if isinstance(q, dict) else q
    code, d = call("/api/exam/answer", {"attemptId": attempt_id, "examQuestionId": qid,
                                        "selectedOptions": [0]})
    if code == 200:
        answered += 1
print(f"4. answered {answered}/{len(questions)}")

# 5. submit
code, d = call("/api/exam/submit", {"attemptId": attempt_id})
assert code == 200, f"submit failed: {code} {d}"
print(f"5. submitted: total={d.get('result', {}).get('totalMarks', d.get('totalMarks'))}")

# 6. stats — mocks array present with our attempt
time.sleep(2)
code, d = call("/api/stats")
assert code == 200, f"stats failed: {code}"
stats = d.get("stats", {})
mocks = stats.get("mocks")
assert isinstance(mocks, list) and len(mocks) >= 1, f"mocks missing: {json.dumps(stats)[:400]}"
m = mocks[0]
print(f"6. mocks[0]: {json.dumps(m, indent=1)[:500]}")
assert m["answered"] == answered, f"answered mismatch: {m['answered']} != {answered}"
assert m["totalQuestions"] >= answered
assert 0 <= m["accuracy"] <= 100
assert m["title"] == f"Probe Mock {suffix}"
assert m["timeSpentSeconds"] >= 0
assert "correct" in m and "score" in m and "maxMarks" in m and "kind" in m
print("7. assertions passed")

# 8. cleanup — delete probe user (cascades attempts, exams created by user)
code, d = call("/api/auth/login", {"email": EMAIL, "password": "pw-mock-pass-123"})
import re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
os.system(f"python3 {os.path.dirname(os.path.abspath(__file__))}/db_query.py "
          f"\"delete from exams where title = 'Probe Mock {suffix}'\" | tail -1")
os.system(f"python3 {os.path.dirname(os.path.abspath(__file__))}/db_query.py "
          f"\"delete from app_users where email = '{EMAIL}'\" | tail -1")
print("8. cleanup done")
