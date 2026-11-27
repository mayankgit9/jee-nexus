#!/usr/bin/env python3
"""Print full source.message for recent jee-nexus-app worker events (both request + exception rows)."""
import json, sys, time, urllib.request

secrets = {}
for line in open('/home/z/my-project/.secrets/cloudflare.env'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        secrets[k] = v

TOKEN = secrets['CLOUDFLARE_API_TOKEN']
ACCT = secrets['ACCOUNT_ID']

minutes = int(sys.argv[1]) if len(sys.argv) > 1 else 10
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
        "limit": 200,
        "since": start,
        "until": now,
    },
    "view": "events",
}
req = urllib.request.Request(
    f'https://api.cloudflare.com/client/v4/accounts/{ACCT}/workers/observability/telemetry/query',
    data=json.dumps(body).encode(),
    headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'},
)
d = json.load(urllib.request.urlopen(req, timeout=60))
events = ((d.get('result', {}).get('events', {}) or {}).get('events', []))
rows = []
for e in events:
    src = e.get('source', {}) if isinstance(e, dict) else {}
    msg = src.get('message', '')
    lvl = src.get('level', '')
    ts = e.get('timestamp', 0)
    exc = (src.get('exception') or {})
    rows.append((ts, lvl, msg, exc))

rows.sort(key=lambda r: -r[0])
for ts, lvl, msg, exc in rows[:40]:
    t = time.strftime('%H:%M:%S', time.gmtime(ts / 1000))
    line = f"{t} [{lvl or '-'}] {msg[:110]}"
    if exc:
        line += f" || EXC: {str(exc.get('message',''))[:150]}"
    print(line)
