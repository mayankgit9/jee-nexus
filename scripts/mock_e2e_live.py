#!/usr/bin/env python3
"""E2E the full-length mock: start -> answer ~20 questions (mix of correct
from DB and wrong) -> submit -> verify section-wise grading adds up."""
import json
import subprocess
import time
import urllib.request

BASE = "https://jee-nexus-app.jee-nexus.workers.dev"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def api(method, path, body=None, cookie=None, timeout=90):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("User-Agent", UA)
    req.add_header("Content-Type", "application/json")
    if cookie:
        req.add_header("Cookie", cookie)
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
        return json.loads(r.read())


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


# login
import urllib.error
req = urllib.request.Request(BASE + "/api/auth/login", method="POST")
req.add_header("User-Agent", UA)
req.add_header("Content-Type", "application/json")
with urllib.request.urlopen(req, data=json.dumps({"email": "admin@jee-nexus.dev", "password": "admin-pass-123"}).encode(), timeout=60) as resp:
    cookie = resp.headers.get("Set-Cookie", "").split(";")[0]

# find the full-length mock
exams = api("GET", "/api/exam/list", cookie=cookie)["exams"]
full = next(e for e in exams if e["kind"] == "full_length")
print("mock:", full["title"], full["questionCount"], "Q")

# start
r = api("POST", "/api/exam/start", {"examId": full["id"]}, cookie=cookie)
attempt_id = r["attemptId"]
qs = r["questions"]
print("attempt:", attempt_id, "| questions served:", len(qs))

# fetch correct answers for all questions
ids = ", ".join(f"'{q['question']['id']}'" for q in qs)
rows = sql(f"SELECT id, correct_options, numerical_answer FROM questions WHERE id IN ({ids});")
correct_by_q = {row["id"]: row for row in rows}

# answer first 30: correct answers for even indexes, deliberately wrong (option 0) for odd
answered = 0
for i, q in enumerate(qs[:30]):
    row = correct_by_q.get(q["question"]["id"])
    if row and row["correct_options"] is not None:
        opts = json.loads(row["correct_options"]) if isinstance(row["correct_options"], str) else row["correct_options"]
        payload_opts = opts if i % 2 == 0 and opts else [0]
    elif row:
        val = row["numerical_answer"]
        payload_opts = None
        # even = correct, odd = wrong (off by 100)
        num = str(val if i % 2 == 0 else (val or 0) + 100)
    else:
        continue
    body = {"attemptId": attempt_id, "examQuestionId": q["examQuestionId"]}
    if payload_opts is not None:
        body["selectedOptions"] = payload_opts
    else:
        body["numericalValue"] = num
    api("POST", "/api/exam/answer", body, cookie=cookie)
    answered += 1
print("answered:", answered)

# submit
t0 = time.time()
r = api("POST", "/api/exam/submit", {"attemptId": attempt_id}, cookie=cookie)
print(f"submit took {time.time()-t0:.1f}s")
print("result:", json.dumps({k: r[k] for k in ("totalMarks", "maxMarks", "timeSpentSeconds")}))
for s in r["sections"]:
    print(f"  {s['key']}: {s['marks']}/{s['max']} (correct {s['correct']}, wrong {s['wrong']}, unattempted {s['unattempted']})")

total_answered = sum(s["correct"] + s["wrong"] for s in r["sections"])
print("graded answered:", total_answered, "(expect 30) | unattempted:", sum(s["unattempted"] for s in r["sections"]), "(expect 45)")
