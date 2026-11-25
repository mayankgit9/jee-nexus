#!/usr/bin/env python3
"""Aggregate invocation outcomes + response statuses from CF Workers observability."""
import json, sys, time, urllib.request
from collections import Counter

secrets = {}
for line in open('/home/z/my-project/.secrets/cloudflare.env'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        secrets[k] = v
TOKEN, ACCT = secrets['CLOUDFLARE_API_TOKEN'], secrets['ACCOUNT_ID']

minutes = int(sys.argv[1]) if len(sys.argv) > 1 else 30
now = int(time.time() * 1000)
start = now - minutes * 60 * 1000

body = {
    "queryId": "",
    "timeframe": {"from": start, "to": now},
    "parameters": {
        "datasets": ["cloudflare-workers"],
        "filters": [{"key": "$metadata.service", "operation": "eq",
                     "value": "jee-nexus-app", "type": "string"}],
        "limit": 300,
        "since": start,
        "until": now,
    },
    "view": "events",
    "limit": 300,
    "since": start,
    "until": now,
}
req = urllib.request.Request(
    f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/workers/observability/telemetry/query",
    data=json.dumps(body).encode(),
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    method="POST")
with urllib.request.urlopen(req, timeout=45) as r:
    data = json.loads(r.read())

events = data.get("result", {}).get("events", {}).get("events", [])
outcomes = Counter()
status = Counter()
errs = []
for e in events:
    w = e.get("$workers", {}) or {}
    oc = w.get("outcome", "?")
    outcomes[oc] += 1
    ev = w.get("event", {}) or {}
    resp = (ev.get("response") or {})
    code = resp.get("status") if isinstance(resp, dict) else None
    url = ((ev.get("request") or {}).get("url") or "?")
    path = url.replace("https://jee-nexus-app.jee-nexus.workers.dev", "")[:70]
    status[(oc, code)] += 1
    if oc not in ("ok", "canceled") and len(errs) < 12:
        exc = w.get("exceptions") or []
        errs.append((oc, path, code, json.dumps(exc)[:300]))

print("outcomes:", dict(outcomes))
print("outcome/status:", dict(status))
print("--- non-ok samples:")
for x in errs:
    print(x)
