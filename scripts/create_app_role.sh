#!/usr/bin/env bash
# JEE NEXUS — set the real jee_app role password (secret stays in .secrets only).
# Assumes 0003_app_role.sql has created the role (placeholder password).
set -eu
cd /home/z/my-project

NEWPW=$(openssl rand -hex 24)
SQLFILE=$(mktemp /tmp/apppw.XXXXXX.sql)
chmod 600 "$SQLFILE"
trap 'shred -u "$SQLFILE" 2>/dev/null || rm -f "$SQLFILE"' EXIT

printf "alter role jee_app with password '%s';\n" "$NEWPW" > "$SQLFILE"

RESP=$(python3 scripts/supabase_sql.py "$SQLFILE")
if echo "$RESP" | grep -qi 'error'; then
  echo "$RESP" | head -c 200; echo; echo "APP_ROLE_PW_FAILED"; exit 1
fi

NEWPW="$NEWPW" python3 - <<'EOF'
import os
new = os.environ['NEWPW']
path = '.secrets/supabase_db.env'
lines = open(path).read().splitlines()
out = []
has_user = has_pass = False
for l in lines:
    if l.startswith('APP_USER='):
        out.append('APP_USER=jee_app.' + open(path).read().split('DB_REF=')[1].strip())
        has_user = True
    elif l.startswith('APP_PASS='):
        out.append(f'APP_PASS={new}'); has_pass = True
    else:
        out.append(l)
if not has_user: out.append('APP_USER=jee_app.' + [l.split('=',1)[1].strip() for l in lines if l.startswith('DB_REF=')][0])
if not has_pass: out.append(f'APP_PASS={new}')
open(path, 'w').write('\n'.join(out) + '\n')
print('secrets file updated: APP_USER + APP_PASS (len=%d)' % len(new))
EOF

echo "APP_ROLE_PW_OK"
