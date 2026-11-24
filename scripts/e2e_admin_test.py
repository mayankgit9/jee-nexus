#!/usr/bin/env python3
"""JEE NEXUS — admin & import pipeline E2E test."""
import json
import subprocess
import sys
import time

BASE = "http://localhost:3000"
ADMIN_JAR = "/tmp/jn_admin_jar.txt"
STUDENT_JAR = "/tmp/jn_student_jar.txt"

passed = 0
failed = 0

def call(method, path, body=None, jar=ADMIN_JAR):
    cmd = ["curl", "-sS", "-m", "20", "-X", method, f"{BASE}{path}", "-H", "Content-Type: application/json",
           "-b", jar, "-c", jar]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(r.stdout) if r.stdout.strip() else {}

def status_code(method, path, body=None, jar=ADMIN_JAR):
    cmd = ["curl", "-sS", "-m", "15", "-X", method, f"{BASE}{path}", "-H", "Content-Type: application/json",
           "-o", "/dev/null", "-w", "%{http_code}"]
    if jar is not None:
        cmd += ["-b", jar]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()

def check(name, cond, extra=""):
    global passed, failed
    ok = bool(cond)
    print(f"{'PASS' if ok else 'FAIL'}  {name} {extra}")
    if ok:
        passed += 1
    else:
        failed += 1

import os
for f in (ADMIN_JAR, STUDENT_JAR):
    if os.path.exists(f):
        os.remove(f)

ts = int(time.time())

# --- whitelisted admin email becomes admin; second account stays student ---
r = call("POST", "/api/auth/signup", {"email": "admin@jee-nexus.dev", "password": "admin-pass-123", "name": "Admin"}, jar=ADMIN_JAR)
if "user" not in r:
    # account exists from a previous run — log in instead
    r = call("POST", "/api/auth/login", {"email": "admin@jee-nexus.dev", "password": "admin-pass-123"}, jar=ADMIN_JAR)
admin_is_admin = r.get("user", {}).get("role") == "admin"
check("admin account has admin role (first user or whitelist)", admin_is_admin, f"(role={r.get('user', {}).get('role')})")
if not admin_is_admin:
    print("NOTE: DB already has users; admin role needs ADMIN_EMAILS whitelist or DB update.")
    sys.exit(1)

r = call("POST", "/api/auth/signup", {"email": f"student-{ts}@jee-nexus.dev", "password": "student-pass-1", "name": "Student"}, jar=STUDENT_JAR)
check("second account is student", r.get("user", {}).get("role") == "student")

# --- access control ---
check("student blocked from admin stats (403)", status_code("GET", "/api/admin/stats", jar=STUDENT_JAR) == "403")
check("student blocked from import (403)", status_code("POST", "/api/admin/import", {"questions": []}, jar=STUDENT_JAR) == "403")
check("anonymous blocked from admin (401)", status_code("GET", "/api/admin/stats", jar=None) == "401")

# --- import: mixed valid/invalid/duplicate rows ---
good_q = {
    "publicId": f"TEST-IMP-{ts}-1",
    "subjectKey": "physics", "chapterKey": "physics:oscillations",
    "type": "mcq_single", "text": f"Test import question about pendulum period {ts}",
    "options": ["$2\\pi\\sqrt{l/g}$", "$2\\pi\\sqrt{l/(g+a)}$", "3", "4"],
    "correctOptions": [0], "difficulty": "easy", "sourceYear": 2024,
    "solution": {"body": "Effective gravity inside the lift: the period uses standard formula.", "keyConcept": "Pendulum"},
}
bad_subject = {**good_q, "publicId": f"TEST-IMP-{ts}-2", "subjectKey": "biology", "text": f"Biology question that should be rejected {ts}"}
bad_options = {**good_q, "publicId": f"TEST-IMP-{ts}-3", "text": f"Question with out-of-range answer {ts}", "correctOptions": [7]}
bad_numerical = {"subjectKey": "chemistry", "chapterKey": "chemistry:atomic-structure", "type": "numerical",
                 "text": f"Numerical question missing its answer {ts}", "difficulty": "medium"}
good_numerical = {"subjectKey": "mathematics", "chapterKey": "mathematics:sequences-series", "type": "numerical",
                  "text": f"Sum of first 10 natural numbers equals x. Find x. {ts}",
                  "numericalAnswer": "55", "difficulty": "easy", "sourceYear": 2023}

r = call("POST", "/api/admin/import", {"questions": [good_q, bad_subject, bad_options, bad_numerical, good_numerical]})
check("import returns counts", "inserted" in r, str({k: v for k, v in r.items() if k != 'errors'}))
check("2 valid rows inserted", r.get("inserted") == 2, f"(inserted={r.get('inserted')})")
check("3 invalid rows rejected", r.get("rejected") == 3, f"(rejected={r.get('rejected')})")
errs = {e["row"]: e["error"] for e in r.get("errors", [])}
check("bad subject rejected w/ reason", "unknown subjectKey" in errs.get(2, ""))
check("out-of-range answer rejected w/ reason", "out of range" in errs.get(3, ""))
check("missing numerical answer rejected w/ reason", "missing numericalAnswer" in errs.get(4, ""))

# --- duplicate detection (re-import same content) ---
r = call("POST", "/api/admin/import", {"questions": [good_q]})
check("re-import detected as duplicate", r.get("skippedDuplicate") == 1 and r.get("inserted") == 0)

# --- imported questions are never verified ---
r = call("GET", "/api/admin/questions?status=imported&search=" + str(ts))
qs = r.get("questions", [])
check("imported questions listed with status 'imported'", all(q["verificationStatus"] == "imported" for q in qs) and len(qs) >= 2)

# --- verify workflow ---
target = next((q for q in qs if q["type"] == "mcq_single"), None)
if target:
    r = call("PATCH", "/api/admin/questions", {"id": target["id"], "verificationStatus": "verified"})
    check("question verified via PATCH", r.get("ok") is True)
    r = call("GET", "/api/admin/questions?status=verified&search=" + str(ts))
    check("verified question appears in verified filter", any(q["id"] == target["id"] for q in r.get("questions", [])))
    # invalid transition target check
    r = call("PATCH", "/api/admin/questions", {"id": target["id"], "verificationStatus": "bogus"})
    check("invalid status rejected", "error" in r)

# --- edit workflow ---
if target:
    r = call("PATCH", "/api/admin/questions", {"id": target["id"], "difficulty": "hard"})
    check("difficulty edited", r.get("ok") is True)
    r = call("GET", f"/api/admin/questions?search={ts}&status=verified")
    edited = next((q for q in r.get("questions", []) if q["id"] == target["id"]), None)
    check("edit persisted", edited is not None and edited["difficulty"] == "hard")

# --- reports flow: student reports, admin resolves ---
r = call("POST", "/api/questions/random", {"count": 1}, jar=STUDENT_JAR)
qid = r["questions"][0]["id"]
r = call("POST", "/api/reports", {"questionId": qid, "reason": "typo", "details": "admin e2e test report"}, jar=STUDENT_JAR)
check("student report accepted", r.get("ok") is True)

r = call("GET", "/api/admin/reports")
check("report visible in admin queue", any(rep["question"]["publicId"] for rep in r.get("reports", [])))
rep = next((rep for rep in r.get("reports", []) if rep["details"] == "admin e2e test report"), None)
if rep:
    r = call("PATCH", "/api/admin/reports", {"id": rep["id"], "action": "resolved"})
    check("report resolved", r.get("ok") is True)
    r = call("GET", "/api/admin/reports")
    check("resolved report gone from open queue", not any(x["id"] == rep["id"] for x in r.get("reports", [])))

# --- admin stats ---
r = call("GET", "/api/admin/stats")
check("admin stats load", "pipeline" in r and "totals" in r)
check("import job tracked", any(j["inserted"] >= 2 for j in r.get("importJobs", [])))

print(f"\nRESULT: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
