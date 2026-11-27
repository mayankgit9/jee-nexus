#!/usr/bin/env python3
"""Query CF Workers GraphQL analytics: cpuTime + errors for jee-nexus-app."""
import json, sys, time, urllib.request

secrets = {}
for line in open('/home/z/my-project/.secrets/cloudflare.env'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        secrets[k] = v

TOKEN = secrets['CLOUDFLARE_API_TOKEN']
ACCT = secrets['ACCOUNT_ID']

hours = float(sys.argv[1]) if len(sys.argv) > 1 else 6
now = int(time.time())
start = now - int(hours * 3600)
start_s = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(start))
now_s = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now))

q = """{
  viewer {
    accounts(filter: {accountTag: "%s"}) {
      workersInvocationsAdaptive(
        limit: 100
        filter: {scriptName: "jee-nexus-app", datetime_geq: "%s", datetime_leq: "%s"}
        orderBy: [datetimeMinute_DESC]
      ) {
        quantiles { cpuTimeP50 cpuTimeP99 }
        sum { requests errors subrequests }
        dimensions { datetimeMinute status }
      }
    }
  }
}""" % (ACCT, start_s, now_s)

req = urllib.request.Request(
    'https://api.cloudflare.com/client/v4/graphql',
    data=json.dumps({'query': q}).encode(),
    headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'},
)
d = json.load(urllib.request.urlopen(req, timeout=30))
rows = d.get('data', {}).get('viewer', {}).get('accounts', [{}])[0].get('workersInvocationsAdaptive', [])
print(f"{'minute':16} {'status':7} {'reqs':6} {'errs':5} {'subs':6} cpuP50ms cpuP99ms")
for r in rows[:40]:
    dim = r['dimensions']
    qn = r.get('quantiles', {})
    s = r.get('sum', {})
    print(f"{dim['datetimeMinute']:16} {dim['status']:7} {s.get('requests',0):6} {s.get('errors',0):5} {s.get('subrequests',0):6} {qn.get('cpuTimeP50',0)/1000:7.1f} {qn.get('cpuTimeP99',0)/1000:8.1f}")
