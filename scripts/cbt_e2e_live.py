#!/usr/bin/env python3
"""Full CBT E2E on the live worker: generate exam -> start -> autosave CORRECT
answers (correctOptions fetched from the production DB via the Supabase SQL
API) -> submit -> expect a perfect score. Proves the whole grading loop."""
import json
import subprocess
import time
import urllib.request

BASE = "https://jee-nexus-app.jee-nexus.workers.dev"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def api(method, path, body=None, cookie=None, timeout=60):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("User-Agent", UA)
    req.add_header("Content-Type", "application/json")
    if cookie:
        req.add_header("Cookie", cookie)
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
        return r.status, json.loads(r.read())


def sql(q):
    with open("/home/z/my-project/.secrets/tokens.env") as f:
        pat = [l.split("=", 1)[1].strip() for l in f if l.startswith("SB_PAT=")][0]
    r = subprocess.run(
        ["curl", "-sS", "-m", "60", "-X", "POST",
         "-H", f"Authorization: Bearer {pat}",
         "-H", "Content-Type: application/json",
         "https://api.supabase.com/v1/projects/mxfiazcjcgqzqynmsefp/database/query",
         "-d", json.dumps({"query": q})],
        capture_output=True, text=True)
    return json.loads(r.stdout)


# 1. fresh user
email = f"cbt_e2e_{int(time.time())}@test.jee-nexus.dev"
_, r = api("POST", "/api/auth/signup", {"email": email, "password": "E2e-Pass-123!", "name": "CBT E2E"})
cookie = f"jee_nexus_session={r['sessionToken']}" if r.get("user", {}).get("sessionToken") else None
print("signup:", r["user"]["email"], "| role:", r["user"]["role"])
# signup sets the cookie via Set-Cookie; body may not carry the token — login again
_, r = api("POST", "/api/auth/login", {"email": email, "password": "E2e-Pass-123!"})
print("login ok, user:", r["user"]["id"])

# get session cookie via a login with headers
import urllib.error
req = urllib.request.Request(BASE + "/api/auth/login", method="POST")
req.add_header("User-Agent", UA)
req.add_header("Content-Type", "application/json")
with urllib.request.urlopen(req, data=json.dumps({"email": email, "password": "E2e-Pass-123!"}).encode(), timeout=60) as resp:
    sc = resp.headers.get("Set-Cookie", "")
cookie = sc.split(";")[0]
print("cookie:", cookie[:40] + "...")

# 2. generate a small custom exam
_, r = api("POST", "/api/exam/list", {"title": "CBT E2E grading test", "kind": "custom", "questionsPerSubject": 1, "durationMinutes": 15}, cookie=cookie)
exam_id = r["examId"]
print("exam generated:", exam_id)

# 3. start
_, r = api("POST", "/api/exam/start", {"examId": exam_id}, cookie=cookie)
attempt_id = r["attemptId"]
questions = r["questions"]
print("attempt:", attempt_id, "| questions:", len(questions))

# 4. fetch correct answers from the DB
ids = ", ".join(f"'{q['question']['id']}'" for q in questions)
rows = sql(f"SELECT id, correct_options, numerical_answer FROM questions WHERE id IN ({ids});")
correct_by_q = {row["id"]: row for row in rows}
print("db rows for correct answers:", len(rows))

# 5. autosave the CORRECT answer for each question
for q in questions:
    qid = q["question"]["id"]
    row = correct_by_q.get(qid)
    if not row:
        print("  !! no db row for", qid)
        continue
    if row["correct_options"] is not None:
        opts = json.loads(row["correct_options"]) if isinstance(row["correct_options"], str) else row["correct_options"]
        payload = {"attemptId": attempt_id, "examQuestionId": q["examQuestionId"], "selectedOptions": opts}
    else:
        payload = {"attemptId": attempt_id, "examQuestionId": q["examQuestionId"], "numericalValue": str(row["numerical_answer"])}
    _, r = api("POST", "/api/exam/answer", payload, cookie=cookie)
    print(f"  saved {q['question']['publicId']}: {'opts=' + str(opts) if row['correct_options'] is not None else 'num=' + str(row['numerical_answer'])} -> ok")

# 6. submit
_, r = api("POST", "/api/exam/submit", {"attemptId": attempt_id}, cookie=cookie)
print("SUBMIT:", json.dumps(r)[:400])

# 7. verdict
if r.get("totalMarks") == r.get("maxMarks") and r.get("totalMarks", 0) > 0:
    print(f"\n*** GRADING LOOP VERIFIED: {r['totalMarks']}/{r['maxMarks']} ***")
else:
    print("\n*** GRADING MISMATCH ***")
