#!/usr/bin/env python3
"""Fetch ALL events for a specific request id."""
import json, sys, time, urllib.request

secrets = {}
for line in open('/home/z/my-project/.secrets/cloudflare.env'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        secrets[k] = v

TOKEN = secrets['CLOUDFLARE_API_TOKEN']
ACCT = secrets['ACCOUNT_ID']
req_id = sys.argv[1]
minutes = int(sys.argv[2]) if len(sys.argv) > 2 else 120

now = int(time.time() * 1000)
start = now - minutes * 60 * 1000

body = {
    "queryId": "",
    "timeframe": {"from": start, "to": now},
    "parameters": {
        "datasets": ["cloudflare-workers"],
        "filters": [
            {"key": "$metadata.service", "operation": "eq", "value": "jee-nexus-app", "type": "string"},
            {"key": "$metadata.requestId", "operation": "eq", "value": req_id, "type": "string"},
        ],
        "limit": 100,
        "since": start,
        "until": now,
    },
    "view": "events",
    "limit": 100,
    "since": start,
    "until": now,
}

req = urllib.request.Request(
    f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/workers/observability/telemetry/query",
    data=json.dumps(body).encode(),
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    method="POST",
)

with urllib.request.urlopen(req, timeout=30) as r:
    data = json.loads(r.read())

events = (data.get('result', {}).get('events', {}) or {}).get('events', [])
events.sort(key=lambda e: e.get('timestamp', 0))
print(f"events for request {req_id}: {len(events)}\n")
for ev in events:
    ts = ev.get('timestamp')
    lvl = (ev.get('source') or {}).get('level', '?')
    msg = (ev.get('source') or {}).get('message', '')
    print(f"--- [{lvl}] {ts}")
    print(msg[:2500])
    print()
