#!/usr/bin/env python3
"""Admin positive-path E2E — runs with the SQL-promoted e2e admin account."""
import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
PASS = 0
FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok  {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name} {detail}")


def req(method, path, body=None, cookie=None):
    r = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    if body is not None:
        r.add_header("Content-Type", "application/json")
    if cookie:
        r.add_header("Cookie", cookie)
    try:
        res = urllib.request.urlopen(r, timeout=120)
        return res.status, json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def main():
    # login as the promoted admin test account
    s, r = req("POST", "/api/auth/login", {"username": "tester1795897351", "password": "TestPass123!"})
    cookie = f"jee_nexus_session={r['user']['id'][:0]}" if False else None
    # real login needs the cookie jar
    import urllib.error
    rq = urllib.request.Request(BASE + "/api/auth/login", data=json.dumps({"username": "tester1795897351", "password": "TestPass123!"}).encode(), method="POST")
    rq.add_header("Content-Type", "application/json")
    res = urllib.request.urlopen(rq, timeout=60)
    cookie = res.headers.get("Set-Cookie").split(";")[0]
    print("logged in as admin")

    def a(method, path, body=None):
        return req(method, path, body, cookie)

    print("== admin: solutions review workflow ==")
    s, r = a("GET", "/api/admin/solutions?filter=ai_generated")
    check("queue loads", s == 200 and r.get("rows") is not None, str(r)[:100])
    check("status counts present", isinstance(r.get("statusCounts"), dict))
    check("generation telemetry present", "generation" in r and "runs" in r["generation"])
    s, r = a("GET", "/api/admin/solutions?filter=thin")
    check("thin queue counts", s == 200 and isinstance(r.get("total"), int))

    if r.get("rows"):
        sol_id = r["rows"][0]["id"]
        s, r2 = a("GET", f"/api/admin/solutions?solutionId={sol_id}")
        check("solution detail + history", s == 200 and r2.get("solution") is not None)
        s, r3 = a("PATCH", "/api/admin/solutions", {"solutionId": sol_id, "action": "approve_independent"})
        check("approve independently_checked", s == 200 and r3.get("solution", {}).get("reviewStatus") == "independently_checked", str(r3)[:120])
        s, r4 = a("PATCH", "/api/admin/solutions", {"solutionId": sol_id, "action": "mark_reviewed"})
        check("reset to ai_generated", s == 200 and r4.get("solution", {}).get("reviewStatus") == "ai_generated")

    print("== admin: images ==")
    s, r = a("GET", "/api/admin/images?filter=summary")
    check("image summary", s == 200 and "total" in r and "hidden" in r)
    s, r = a("POST", "/api/admin/images", {"action": "audit", "sample": 25})
    check("image audit run", s == 200 and r.get("checked") == 25, str(r)[:120])
    s, r = a("GET", "/api/admin/images?filter=broken")
    check("image broken queue", s == 200 and isinstance(r.get("rows"), list))

    print(f"\nPASS {PASS} · FAIL {FAIL}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
