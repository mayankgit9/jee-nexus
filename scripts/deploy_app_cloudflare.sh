#!/usr/bin/env bash
# JEE NEXUS — deploy the full Next.js app to Cloudflare Workers via OpenNext.
#
# PREREQUISITES:
#   1. A Cloudflare API token with Workers Scripts:Edit (account-level).
#      Stored in .secrets/cloudflare.env as CLOUDFLARE_API_TOKEN.
#      Hyperdrive:Edit is OPTIONAL — only needed to create the Hyperdrive
#      config (pooling/cache accelerator); the app falls back to direct TCP
#      from Workers via the DATABASE_URL secret when HYPERDRIVE is unbound.
#   2. The DATABASE_URL worker secret (one-time, or after any password reset):
#        bunx wrangler secret put DATABASE_URL --name jee-nexus-app
#      URL = Supabase SESSION pooler as jee_app (port 5432, NOT 6543):
#        postgresql://jee_app.kwavmbowgvgphaccrqlc:<PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
#   3. (Optional, needs Hyperdrive:Edit) create the config and paste its id
#      into wrangler.jsonc (hyperdrive binding):
#        curl -X POST .../accounts/$ACCOUNT/hyperdrive/config -d '{
#          "name": "jee-nexus-db",
#          "origin": { "database": "postgres", "host": "aws-0-ap-south-1.pooler.supabase.com",
#                      "port": 5432, "scheme": "postgres",
#                      "user": "jee_app.kwavmbowgvgphaccrqlc", "password": "<PASSWORD>" } }'
#
# THEN this script performs the deploy:
set -eu
cd /home/z/my-project

if [ ! -f .secrets/cloudflare.env ]; then echo "missing .secrets/cloudflare.env"; exit 1; fi
set -a
. .secrets/cloudflare.env
set +a
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN not set in .secrets/cloudflare.env}"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-d847f3e3bffdd74a6df0ecfbf150df31}"

# guard: never deploy with the hyperdrive placeholder id accidentally wired
if grep -q '<hyperdrive-config-id>' wrangler.jsonc; then
  echo "REFUSED: wrangler.jsonc still has the <hyperdrive-config-id> placeholder."
  exit 1
fi

echo "— building (OpenNext → .open-next/) —"
unset DATABASE_URL
# next build evaluates route modules; PrismaClient constructor requires a
# syntactically valid DATABASE_URL even though no query runs at build time.
export DATABASE_URL='postgresql://build:build@127.0.0.1:5432/build'
bunx opennextjs-cloudflare build

echo "— deploying worker + assets —"
# With a narrowly-scoped token, wrangler's post-deploy status read
# (GET /workers/workers/{name}) can fail with 10007 even though the upload
# succeeded — judge success by the "Uploaded <name>" marker, not the exit code.
set +e
DEPLOY_LOG="$(bunx wrangler deploy 2>&1)"
set -e
echo "$DEPLOY_LOG" | tail -25
if ! echo "$DEPLOY_LOG" | grep -q "Uploaded jee-nexus-app"; then
  echo "FATAL: worker upload did not complete."
  exit 1
fi

echo "— enabling the workers.dev route —"
# The route can ship disabled (the URL 404s with error 1042 until enabled);
# enabling is idempotent.
if curl -s -f -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/jee-nexus-app/subdomain" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true}' >/dev/null; then
  echo "workers.dev route: enabled"
else
  echo "WARNING: could not enable the workers.dev route (check token scope)."
fi

echo "— checking the DATABASE_URL secret —"
if bunx wrangler secret list --name jee-nexus-app 2>/dev/null | grep -q DATABASE_URL; then
  echo "DATABASE_URL secret: present"
else
  echo "NOTE: DATABASE_URL secret not set — DB-backed routes will 500 until:"
  echo "  bunx wrangler secret put DATABASE_URL --name jee-nexus-app"
  echo "  (Supabase SESSION pooler URL as jee_app — see wrangler.jsonc)"
fi

echo "— done. Verify: https://jee-nexus-app.jee-nexus.workers.dev —"
