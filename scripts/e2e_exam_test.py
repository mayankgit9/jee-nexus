#!/usr/bin/env python3
"""JEE NEXUS — CBT exam E2E test (API level)."""
import json
import subprocess
import sys
import time

BASE = "http://localhost:3000"
JAR = "/tmp/jn_exam_jar.txt"

passed = 0
failed = 0

def call(method, path, body=None):
    cmd = ["curl", "-sS", "-m", "20", "-X", method, f"{BASE}{path}", "-H", "Content-Type: application/json",
           "-b", JAR, "-c", JAR]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(r.stdout) if r.stdout.strip() else {}

def check(name, cond, extra=""):
    global passed, failed
    print(f"{'PASS' if cond else 'FAIL'}  {name} {extra}")
    passed += 1 if cond else 0
    failed += 0 if cond else 1

import os
if os.path.exists(JAR):
    os.remove(JAR)

# --- login (fresh account) ---
email = f"exam-e2e-{int(time.time())}@jee-nexus.dev"
r = call("POST", "/api/auth/signup", {"email": email, "password": "exam-e2e-pass-1", "name": "Exam E2E"})
check("signup for exam test", "user" in r)

# --- create custom exam ---
r = call("POST", "/api/exam/list", {"title": "E2E Physics Test", "kind": "subject", "subjectKey": "physics", "questionsPerSubject": 5, "durationMinutes": 10})
check("custom exam generated", "examId" in r, str(r.get("warnings", "")))
exam_id = r.get("examId")

r = call("GET", "/api/exam/list")
check("exam appears in list", any(e["id"] == exam_id for e in r.get("exams", [])))

# --- start ---
r = call("POST", "/api/exam/start", {"examId": exam_id})
check("exam starts with questions", "attemptId" in r and len(r.get("questions", [])) > 0, f"({len(r.get('questions', []))} questions)")
check("no answers leaked in start payload", all("isCorrect" not in str(q["question"]["options"][0]) for q in r["questions"] if q["question"]["options"]))
check("endsAt in future", r.get("endsAt", "") > "2000")
attempt_id = r["attemptId"]
questions = r["questions"]

# --- answer questions ---
mcq = next((q for q in questions if q["question"]["type"] == "mcq_single"), None)
if mcq:
    r = call("POST", "/api/exam/answer", {"attemptId": attempt_id, "examQuestionId": mcq["examQuestionId"], "selectedOptions": [0], "timeDeltaSeconds": 30})
    check("mcq answer saved", r.get("ok") is True)
multi = next((q for q in questions if q["question"]["type"] == "mcq_multi"), None)
if multi:
    r = call("POST", "/api/exam/answer", {"attemptId": attempt_id, "examQuestionId": multi["examQuestionId"], "selectedOptions": [0, 1], "markedForReview": True})
    check("multi answer + mark-for-review saved", r.get("ok") is True)
num = next((q for q in questions if q["question"]["type"] == "numerical"), None)
if num:
    r = call("POST", "/api/exam/answer", {"attemptId": attempt_id, "examQuestionId": num["examQuestionId"], "numericalValue": "3.47"})
    check("numerical answer saved", r.get("ok") is True)

# --- resume returns saved state ---
r2 = call("POST", "/api/exam/start", {"examId": exam_id})
check("resume returns same attempt", r2.get("attemptId") == attempt_id)
saved = r2.get("savedAnswers", {})
if mcq:
    check("resume restores saved selection", saved.get(mcq["examQuestionId"], {}).get("selectedOptions") == [0])
if multi:
    check("resume restores mark-for-review", saved.get(multi["examQuestionId"], {}).get("markedForReview") is True)

# --- submit ---
r = call("POST", "/api/exam/submit", {"attemptId": attempt_id})
check("submission graded", "totalMarks" in r and "maxMarks" in r, f"score {r.get('totalMarks')}/{r.get('maxMarks')}")
check("status submitted", r.get("status") == "submitted")
check("sections present", len(r.get("sections", [])) > 0)
total_marks = r.get("totalMarks")

# --- double submit rejected ---
r = call("POST", "/api/exam/submit", {"attemptId": attempt_id})
check("double submit rejected (409)", "error" in r)

# --- result review ---
r = call("GET", f"/api/exam/result?attemptId={attempt_id}")
check("result loads", r.get("attempt", {}).get("totalMarks") == total_marks)
review = r.get("review", [])
check("review has all questions with answers", len(review) == len(questions))
check("review includes solutions", any(q.get("solution") for q in review))
check("review marks awarded present", all("marksAwarded" in q["yourAnswer"] for q in review))
if mcq:
    rm = next(q for q in review if q["examQuestionId"] == mcq["examQuestionId"])
    correct_idx = [o["idx"] for o in rm["question"]["options"] if o["isCorrect"]]
    expected = 4 if correct_idx == [0] else -1
    check(f"mcq grading matches ({expected:+d} expected)", rm["yourAnswer"]["marksAwarded"] == expected,
          f"(correct={correct_idx}, chose=[0], got {rm['yourAnswer']['marksAwarded']})")

# --- attempt history ---
r = call("GET", "/api/exam/result")
check("attempt history lists attempt", any(a["id"] == attempt_id for a in r.get("attempts", [])))

# --- security: anonymous cannot start ---
r = subprocess.run(["curl", "-sS", "-m", "15", "-X", "POST", f"{BASE}/api/exam/start", "-H", "Content-Type: application/json",
                    "-d", json.dumps({"examId": exam_id}), "-o", "/dev/null", "-w", "%{http_code}"], capture_output=True, text=True).stdout
check("anonymous exam start rejected (401)", r == "401")

print(f"\nRESULT: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
