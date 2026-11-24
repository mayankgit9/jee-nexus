#!/usr/bin/env python3
"""Find the actual error message events ([api] console.error first lines) for exam/list."""
import json, time, urllib.request

secrets = {}
for line in open('/home/z/my-project/.secrets/cloudflare.env'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        secrets[k] = v

TOKEN = secrets['CLOUDFLARE_API_TOKEN']
ACCT = secrets['ACCOUNT_ID']

now = int(time.time() * 1000)
start = now - 180 * 60 * 1000  # last 3 hours

body = {
    "queryId": "",
    "timeframe": {"from": start, "to": now},
    "parameters": {
        "datasets": ["cloudflare-workers"],
        "filters": [
            {"key": "$metadata.service", "operation": "eq", "value": "jee-nexus-app", "type": "string"},
        ],
        "limit": 1000,
        "since": start,
        "until": now,
    },
    "view": "events",
    "limit": 1000,
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
print(f"total: {len(events)}")
seen = set()
for ev in events:
    msg = (ev.get('source') or {}).get('message', '')
    lvl = (ev.get('source') or {}).get('level', '')
    if lvl == 'error' and 'at ' not in msg.split('\n')[0][:60]:
        first = msg.split('\n')[0][:300]
        if first not in seen:
            seen.add(first)
            path = (((ev.get('$workers') or {}).get('event') or {}).get('request') or {}).get('path', '?')
            print(f"[{path}] {first}")
