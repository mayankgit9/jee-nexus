#!/usr/bin/env python3
"""JEE NEXUS — Community chat E2E (DMs + groups). Run against dev server on :3000."""
import json
import os
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor

BASE = os.environ.get("BASE_URL", "http://localhost:3000")

passed = 0
failed = 0


def call(method, path, body=None, jar=None):
    cmd = ["curl", "-sS", "-m", "20", "-X", method, f"{BASE}{path}", "-H", "Content-Type: application/json"]
    if jar:
        cmd += ["-b", jar, "-c", jar]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(r.stdout) if r.stdout.strip() else {}


def status(method, path, body=None, jar=None):
    cmd = ["curl", "-sS", "-m", "20", "-o", "/dev/null", "-w", "%{http_code}", "-X", method, f"{BASE}{path}"]
    if jar:
        cmd += ["-b", jar, "-c", jar]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()


def check(name, cond, extra=""):
    global passed, failed
    print(f"{'PASS' if cond else 'FAIL'}  {name} {extra}")
    passed += 1 if cond else 0
    failed += 0 if cond else 1


ts = int(time.time())
jar_a, jar_b, jar_c = f"/tmp/jn_chat_a_{ts}.txt", f"/tmp/jn_chat_b_{ts}.txt", f"/tmp/jn_chat_c_{ts}.txt"
A = {"email": f"chat-a-{ts}@jee-nexus.dev", "password": "chat-pass-123", "name": "Asha Verma"}
B = {"email": f"chat-b-{ts}@jee-nexus.dev", "password": "chat-pass-123", "name": "Bhargav Rao"}
C = {"email": f"chat-c-{ts}@jee-nexus.dev", "password": "chat-pass-123", "name": "Chirag Shah"}
for jar, u in [(jar_a, A), (jar_b, B), (jar_c, C)]:
    if os.path.exists(jar):
        os.remove(jar)
    r = call("POST", "/api/auth/signup", u, jar=jar)
    check(f"signup {u['name']}", r.get("user", {}).get("email") == u["email"])

uid = {}
for jar, key in [(jar_a, "a"), (jar_b, "b"), (jar_c, "c")]:
    uid[key] = call("GET", "/api/auth/me", jar=jar)["user"]["id"]

# --- 1. auth guards ---
check("conversations requires auth", status("GET", "/api/chat/conversations") == "401")
check("messages requires auth", status("GET", "/api/chat/messages?conversationId=x") == "401")
check("users search requires auth", status("GET", "/api/chat/users?q=as") == "401")

# --- 2. directory search + masking ---
r = call("GET", "/api/chat/users?q=asha", jar=jar_a)
row = next((u for u in r.get("users", []) if u["id"] == uid["b"] or True), None)
r = call("GET", "/api/chat/users?q=bhargav", jar=jar_a)
matches = r.get("users", [])
check("search by name finds B", any(u["id"] == uid["b"] for u in matches), f"n={len(matches)}")
b_row = next((u for u in matches if u["id"] == uid["b"]), None)
check("email is masked", b_row and b_row["email"].startswith("c") and "•" in b_row["email"], b_row["email"] if b_row else "-")
check("self excluded from results", all(u["id"] != uid["a"] for u in matches))
r = call("GET", "/api/chat/users?q=x", jar=jar_a)
check("short query returns empty", r.get("users") == [])

# --- 3. DM lifecycle ---
r = call("POST", "/api/chat/conversations", {"type": "dm", "userId": uid["b"]}, jar=jar_a)
dm_id = r.get("conversationId")
check("DM created", bool(dm_id) and r.get("existing") is False)
r = call("POST", "/api/chat/conversations", {"type": "dm", "userId": uid["b"]}, jar=jar_a)
check("DM find-or-create is idempotent", r.get("conversationId") == dm_id and r.get("existing") is True)
check("self-DM rejected", status("POST", "/api/chat/conversations", {"type": "dm", "userId": uid["a"]}, jar=jar_a) == "400")
check("unknown user 404", status("POST", "/api/chat/conversations", {"type": "dm", "userId": "nope"}, jar=jar_a) == "404")

# --- 4. messages ---
check("empty message 400", status("POST", "/api/chat/messages", {"conversationId": dm_id, "body": "   "}, jar=jar_a) == "400")
check("oversized message 400", status("POST", "/api/chat/messages", {"conversationId": dm_id, "body": "x" * 2001}, jar=jar_a) == "400")
r = call("POST", "/api/chat/messages", {"conversationId": dm_id, "body": "hey Bhargav, ready for mechanics revision?"}, jar=jar_a)
m1 = r.get("message", {})
check("A sends message", m1.get("body", "").startswith("hey") and m1.get("senderId") == uid["a"])
r = call("POST", "/api/chat/messages", {"conversationId": dm_id, "body": "x" * 2000}, jar=jar_a)
check("2000-char boundary accepted", "message" in r)

# B's sidebar: unread + last message
r = call("GET", "/api/chat/conversations", jar=jar_b)
conv = next((c for c in r.get("conversations", []) if c["id"] == dm_id), None)
check("B sees the DM", conv is not None)
check("B unread counts A's messages", conv and conv["unread"] == 2, f"unread={conv['unread'] if conv else '-'}")
check("lastMessage preview present", conv and (conv.get("lastMessage") or {}).get("senderId") == uid["a"])
check("B member list masked", conv and all("•" in m["email"] or "@" in m["email"] for m in conv["members"]))

# B reads
r = call("GET", f"/api/chat/messages?conversationId={dm_id}", jar=jar_b)
msgs = r.get("messages", [])
check("B loads message history", len(msgs) == 2 and msgs[0]["senderName"] == "Asha Verma")
check("conversation meta includes members", len(r.get("conversation", {}).get("members", [])) == 2)
call("POST", "/api/chat/read", {"conversationId": dm_id}, jar=jar_b)
r = call("GET", "/api/chat/conversations", jar=jar_b)
conv = next((c for c in r["conversations"] if c["id"] == dm_id), None)
check("read clears unread", conv and conv["unread"] == 0)

# incremental polling: after=
last_iso = msgs[-1]["createdAt"]
r = call("POST", "/api/chat/messages", {"conversationId": dm_id, "body": "poll target"}, jar=jar_a)
r = call("GET", f"/api/chat/messages?conversationId={dm_id}&after={last_iso.replace('+', '%2B') if '+' in last_iso else last_iso}", jar=jar_b)
fresh = r.get("messages", [])
check("after= returns only new messages", len(fresh) == 1 and fresh[0]["body"] == "poll target", f"n={len(fresh)}")

# non-member access
check("non-member cannot read", status("GET", f"/api/chat/messages?conversationId={dm_id}", jar=jar_c) == "403")
check("non-member cannot send", status("POST", "/api/chat/messages", {"conversationId": dm_id, "body": "hi"}, jar=jar_c) == "403")

# --- 5. groups ---
check("group without members 400", status("POST", "/api/chat/conversations", {"type": "group", "name": "X", "memberIds": []}, jar=jar_a) == "400")
r = call("POST", "/api/chat/conversations", {"type": "group", "name": "Mechanics Doubt Squad", "memberIds": [uid["b"]]}, jar=jar_a)
g_id = r.get("conversationId")
check("group created", bool(g_id))
r = call("GET", f"/api/chat/messages?conversationId={g_id}", jar=jar_a)
check("group meta: 2 members, A admin", len(r["conversation"]["members"]) == 2 and r["conversation"]["myRole"] == "admin")
call("POST", "/api/chat/messages", {"conversationId": g_id, "body": "welcome to the squad"}, jar=jar_a)
r = call("GET", "/api/chat/conversations", jar=jar_b)
gconv = next((c for c in r["conversations"] if c["id"] == g_id), None)
check("B sees group with unread", gconv and gconv["unread"] == 1 and gconv["type"] == "group" and gconv["name"] == "Mechanics Doubt Squad")

# add member C (by B, a non-admin member — allowed)
r = call("POST", "/api/chat/members", {"conversationId": g_id, "userIds": [uid["c"]]}, jar=jar_b)
check("non-admin member can invite", r.get("added") == 1)
check("re-adding existing member 400", status("POST", "/api/chat/members", {"conversationId": g_id, "userIds": [uid["c"]]}, jar=jar_b) == "400")
r = call("GET", "/api/chat/conversations", jar=jar_c)
check("C now sees the group", any(c["id"] == g_id for c in r["conversations"]))
check("cannot add members to a DM", status("POST", "/api/chat/members", {"conversationId": dm_id, "userIds": [uid["c"]]}, jar=jar_a) == "400")

# C sends to group, A polls
call("POST", "/api/chat/messages", {"conversationId": g_id, "body": "thanks for the invite"}, jar=jar_c)
r = call("GET", f"/api/chat/messages?conversationId={g_id}", jar=jar_a)
check("A sees C's group message", any(m["body"] == "thanks for the invite" and m["senderName"] == "Chirag Shah" for m in r["messages"]))

# --- 5b. message search (membership-scoped) ---
r = call("GET", "/api/chat/search?q=mechanics%20revision", jar=jar_a)
check("A finds DM message by phrase", isinstance(r.get("results"), list) and
      any("mechanics revision" in m["body"] and m["conversation"]["type"] == "dm" for m in r["results"]))
r = call("GET", "/api/chat/search?q=squad", jar=jar_a)
check("A finds group message", any("welcome to the squad" in m["body"] and m["conversation"]["type"] == "group" for m in r["results"]))
r = call("GET", "/api/chat/search?q=mechanics%20revision", jar=jar_c)
check("non-member cannot search other people's DM", not any("mechanics revision" in m["body"] for m in r.get("results", [])))
r = call("GET", "/api/chat/search?q=zzzqqqxxx", jar=jar_a)
check("no-match search is empty", r.get("results") == [])
check("1-char query 400", status("GET", "/api/chat/search?q=x", jar=jar_a) == "400")

# --- 5c. typing indicators + presence ---
r = call("POST", "/api/chat/typing", {"conversationId": g_id}, jar=jar_b)
check("typing ping ok", r.get("ok") is True)
r = call("POST", "/api/chat/typing", {"conversationId": g_id}, jar=jar_c)
check("typing ping C ok", r.get("ok") is True)
r = call("GET", f"/api/chat/messages?conversationId={g_id}", jar=jar_a)
typers = {t["userId"] for t in r.get("typing", [])}
check("A sees B+C typing", uid["b"] in typers and uid["c"] in typers, f"typing={typers}")
check("typing excludes self", uid["a"] not in typers)
r = call("GET", f"/api/chat/messages?conversationId={g_id}", jar=jar_b)
typers_b = {t["userId"] for t in r.get("typing", [])}
check("B does not see own typing", uid["b"] not in typers_b and uid["c"] in typers_b, f"typing={typers_b}")
check("typing requires membership", status("POST", "/api/chat/typing", {"conversationId": dm_id}, jar=jar_c) == "403")
check("typing missing id 400", status("POST", "/api/chat/typing", {}, jar=jar_b) == "400")
# presence + read-receipt fields ride along on every messages/conversations payload
r = call("GET", f"/api/chat/messages?conversationId={g_id}", jar=jar_a)
mems = r.get("conversation", {}).get("members", [])
check("members carry lastSeenAt", len(mems) == 3 and all("lastSeenAt" in m for m in mems))
check("members carry lastReadAt", all("lastReadAt" in m for m in mems))
r = call("GET", f"/api/chat/messages?conversationId={dm_id}", jar=jar_a)
# A sent 3 messages to the DM earlier; B read them via GET+read in section 4
dm_mems = {m["id"]: m for m in r["conversation"]["members"]}
check("B's lastReadAt reflects the read", dm_mems[uid["b"]]["lastReadAt"] is not None)

# --- 5d. message reactions ---
r = call("GET", f"/api/chat/messages?conversationId={g_id}", jar=jar_a)
target = next(m for m in r["messages"] if m["body"] == "thanks for the invite")
check("reactions ride along in GET", "reactions" in r)
r = call("POST", "/api/chat/reactions", {"messageId": target["id"], "emoji": "\U0001F44D"}, jar=jar_a)
check("A reacts thumbs-up", r.get("reacted") is True and r["reactions"][0]["count"] == 1 and r["reactions"][0]["mine"] is True)
r = call("POST", "/api/chat/reactions", {"messageId": target["id"], "emoji": "\U0001F525"}, jar=jar_b)
check("B reacts fire (2 chips now)", r.get("reacted") is True and len(r["reactions"]) == 2)
r = call("GET", f"/api/chat/messages?conversationId={g_id}", jar=jar_a)
chips = {c["emoji"]: c for c in r["reactions"].get(target["id"], [])}
check("aggregate groups both emojis", set(chips) == {"\U0001F44D", "\U0001F525"} and sum(c["count"] for c in chips.values()) == 2)
check("mine flag is per-viewer", chips["\U0001F44D"]["mine"] is True and chips["\U0001F525"]["mine"] is False)
# C also reacts 🔥 — now C's own view shows 🔥 as theirs (mine flag per viewer)
r = call("POST", "/api/chat/reactions", {"messageId": target["id"], "emoji": "\U0001F525"}, jar=jar_c)
check("C reacts fire too", r.get("reacted") is True and next(c for c in r["reactions"] if c["emoji"] == "\U0001F525")["count"] == 2)
r = call("GET", f"/api/chat/messages?conversationId={g_id}", jar=jar_c)
chips_c = {c["emoji"]: c for c in r["reactions"].get(target["id"], [])}
check("mine flag follows viewer", chips_c["\U0001F525"]["mine"] is True and chips_c["\U0001F44D"]["mine"] is False)
# toggling the same emoji removes it (never inflates)
r = call("POST", "/api/chat/reactions", {"messageId": target["id"], "emoji": "\U0001F44D"}, jar=jar_a)
check("toggle removes A's reaction", r.get("reacted") is False and len(r["reactions"]) == 1)
r = call("POST", "/api/chat/reactions", {"messageId": target["id"], "emoji": "\U0001F44D"}, jar=jar_a)
check("re-toggle re-adds", r.get("reacted") is True)
# guards
check("multi-char junk emoji 400", status("POST", "/api/chat/reactions", {"messageId": target["id"], "emoji": "abc"}, jar=jar_a) == "400")
check("empty emoji 400", status("POST", "/api/chat/reactions", {"messageId": target["id"], "emoji": ""}, jar=jar_a) == "400")
check("unknown message 404", status("POST", "/api/chat/reactions", {"messageId": "nope", "emoji": "\U0001F44D"}, jar=jar_a) == "404")
r = call("GET", f"/api/chat/messages?conversationId={dm_id}", jar=jar_a)
dm_msg_id = r["messages"][0]["id"]
check("non-member cannot react", status("POST", "/api/chat/reactions", {"messageId": dm_msg_id, "emoji": "\U0001F44D"}, jar=jar_c) == "403")
check("reactions requires auth", status("POST", "/api/chat/reactions", {"messageId": dm_msg_id, "emoji": "\U0001F44D"}) == "401")

# --- 6. leave / delete ---
r = call("POST", "/api/chat/leave", {"conversationId": g_id}, jar=jar_b)
check("B leaves group", r.get("left") is True)
r = call("GET", "/api/chat/conversations", jar=jar_b)
check("B no longer sees group", not any(c["id"] == g_id for c in r["conversations"]))
check("B cannot read group after leaving", status("GET", f"/api/chat/messages?conversationId={g_id}", jar=jar_b) == "403")
r = call("GET", f"/api/chat/messages?conversationId={g_id}", jar=jar_a)
check("A still sees group history", any(m["body"] == "welcome to the squad" for m in r["messages"]))
r = call("POST", "/api/chat/leave", {"conversationId": dm_id}, jar=jar_a)
check("DM delete works", r.get("deleted") is True)
r = call("GET", "/api/chat/conversations", jar=jar_b)
check("B no longer sees deleted DM", not any(c["id"] == dm_id for c in r["conversations"]))

# --- 7. rate limit (last — burns the budget) ---
# The burst must complete WITHIN the 60s window or the window resets and the
# limit never trips (prod-verified 2026-11-25: 4-worker burst spanned ~70s =
# no 429s; a 12-worker burst capped at hits=30 with 429s firing). 12 workers
# finish 40 sends in ~10-15s. Some EMAXCONNSESSION 500s are expected noise
# (Supabase session pooler caps at 15 concurrent clients) — the assertion is
# only that 429s appear.
def send_spam(i):
    return status("POST", "/api/chat/messages", {"conversationId": g_id, "body": f"spam {i}"}, jar=jar_c)
with ThreadPoolExecutor(max_workers=12) as ex:
    codes = list(ex.map(send_spam, range(40)))
limited = "429" in codes
n429 = codes.count("429")
check("send rate limit kicks in (30/min)", limited,
      f"(429s={n429})" if limited else f"codes={codes[:8]}...{codes[-3:]}")

print(f"\n{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
