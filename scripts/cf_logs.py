#!/usr/bin/env python3
"""Query Cloudflare Workers observability logs for jee-nexus-app."""
import json, sys, time, urllib.request, ssl

secrets = {}
for line in open('/home/z/my-project/.secrets/cloudflare.env'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        secrets[k] = v

TOKEN = secrets['CLOUDFLARE_API_TOKEN']
ACCT = secrets['ACCOUNT_ID']

minutes = int(sys.argv[1]) if len(sys.argv) > 1 else 30
limit = sys.argv[2] if len(sys.argv) > 2 else 'error'

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
        "limit": 50,
        "since": start,
        "until": now,
    },
    "view": "events",
    "limit": 50,
    "since": start,
    "until": now,
}

if limit != 'all':
    body["parameters"]["filters"].append(
        {"key": "$metadata.error", "operation": "eq", "value": "error", "type": "string"}
    )

req = urllib.request.Request(
    f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/workers/observability/telemetry/query",
    data=json.dumps(body).encode(),
    headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
    },
    method="POST",
)

try:
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}")
    print(e.read().decode()[:2000])
    sys.exit(1)

events = (data.get('result', {}).get('events', {}) or {}).get('events', [])
if not events:
    print("No events found")
    sys.exit(0)

for ev in events:
    ts = ev.get('timestamp', '')
    msg = ev.get('message', json.dumps(ev)[:300])
    # clean up ANSI / newlines
    msg = msg.replace('\n', ' | ')[:600]
    print(f"--- {ts}")
    print(f"    {msg}")
