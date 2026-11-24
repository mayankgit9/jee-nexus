#!/usr/bin/env python3
"""Dump full JSON of recent error events from jee-nexus-app worker."""
import json, sys, time, urllib.request

secrets = {}
for line in open('/home/z/my-project/.secrets/cloudflare.env'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        secrets[k] = v

TOKEN = secrets['CLOUDFLARE_API_TOKEN']
ACCT = secrets['ACCOUNT_ID']

minutes = int(sys.argv[1]) if len(sys.argv) > 1 else 60
now = int(time.time() * 1000)
start = now - minutes * 60 * 1000

body = {
    "queryId": "",
    "timeframe": {"from": start, "to": now},
    "parameters": {
        "datasets": ["cloudflare-workers"],
        "filters": [
            {"key": "$metadata.service", "operation": "eq", "value": "jee-nexus-app", "type": "string"},
        ],
        "limit": 100,
        "since": start,
        "until": now,
    },
    "view": "events",
    "limit": 20,
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
errors = [e for e in events if (e.get('source') or {}).get('level') == 'error' and 'GET http' not in str((e.get('source') or {}).get('message', ''))]
print(f"total events: {len(events)}, error-detail events: {len(errors)}")
for i, ev in enumerate(errors[:5]):
    print(f"\n===== EVENT {i} ts={ev.get('timestamp')} =====")
    print(json.dumps(ev, indent=1)[:5000])
