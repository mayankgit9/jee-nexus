#!/usr/bin/env python3
"""Dump ALL error-level events around a timestamp window (default: last N minutes)."""
import json, sys, time, urllib.request

secrets = {}
for line in open('/home/z/my-project/.secrets/cloudflare.env'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        secrets[k] = v

TOKEN = secrets['CLOUDFLARE_API_TOKEN']
ACCT = secrets['ACCOUNT_ID']

minutes = int(sys.argv[1]) if len(sys.argv) > 1 else 180
now = int(time.time() * 1000)
start = now - minutes * 60 * 1000

body = {
    "queryId": "",
    "timeframe": {"from": start, "to": now},
    "parameters": {
        "datasets": ["cloudflare-workers"],
        "filters": [
            {"key": "$metadata.service", "operation": "eq", "value": "jee-nexus-app", "type": "string"},
            {"key": "$metadata.level", "operation": "eq", "value": "error", "type": "string"},
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
print(f"error-level events: {len(events)}")
for ev in events:
    msg = (ev.get('source') or {}).get('message', '')
    path = (((ev.get('$workers') or {}).get('event') or {}).get('request') or {}).get('path', '?')
    ver = (((ev.get('$workers') or {}).get('scriptVersion') or {}).get('id', '?'))[:8]
    first = msg.split('\n')[0][:250]
    print(f"ts={ev.get('timestamp')} v={ver} [{path}] {first}")
