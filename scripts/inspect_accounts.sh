#!/usr/bin/env bash
# Validate connected account tokens (GitHub / Supabase / Cloudflare).
# Never prints token values - only parsed account metadata.
set -u
. /home/z/my-project/.secrets/tokens.env

echo "=== GITHUB ==="
code=$(curl -sS -m 20 -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" \
  https://api.github.com/user -o /tmp/gh_user.json -w '%{http_code}' 2>/tmp/gh_err.txt)
echo "HTTP $code"
if [ "$code" = "200" ]; then
  python3 -c "import json;d=json.load(open('/tmp/gh_user.json'));print('login:',d.get('login'),'| name:',d.get('name'),'| plan:',d.get('plan',{}).get('name'))"
else
  python3 -c "import json;d=json.load(open('/tmp/gh_user.json'));print('message:',d.get('message'))" 2>/dev/null || cat /tmp/gh_err.txt
fi

echo "=== SUPABASE ==="
code=$(curl -sS -m 20 -H "Authorization: Bearer $SB_PAT" \
  https://api.supabase.com/v1/projects -o /tmp/sb_projects.json -w '%{http_code}' 2>/tmp/sb_err.txt)
echo "HTTP $code"
if [ "$code" = "200" ]; then
  python3 -c "
import json
d=json.load(open('/tmp/sb_projects.json'))
print('project count:',len(d))
for p in d:
    print(' -',p.get('id'),'|',p.get('name'),'|',p.get('status'),'|',p.get('region'),'| db:',p.get('database',{}).get('version'))"
else
  python3 -c "import json;d=json.load(open('/tmp/sb_projects.json'));print('error:',str(d)[:300])" 2>/dev/null || cat /tmp/sb_err.txt
fi

echo "=== CLOUDFLARE ==="
code=$(curl -sS -m 20 -H "Authorization: Bearer $CF_PAT" \
  https://api.cloudflare.com/client/v4/user/tokens/verify -o /tmp/cf_verify.json -w '%{http_code}' 2>/tmp/cf_err.txt)
echo "HTTP $code"
if [ "$code" = "200" ]; then
  python3 -c "import json;d=json.load(open('/tmp/cf_verify.json'));print('success:',d.get('success'),'| token status:',d.get('result',{}).get('status'))"
else
  python3 -c "import json;d=json.load(open('/tmp/cf_verify.json'));print('error:',str(d)[:300])" 2>/dev/null || cat /tmp/cf_err.txt
fi
