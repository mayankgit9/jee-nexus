#!/usr/bin/env bash
# JEE NEXUS — deploy the full Next.js app to Cloudflare Workers via OpenNext.
#
# PREREQUISITES (one-time, currently BLOCKED on token scope — see DEVELOPMENT_LOG.md M11):
#   1. A Cloudflare API token with: Workers Scripts:Edit, Hyperdrive:Edit,
#      Account Settings:Read. The current .secrets/tokens.env CF_PAT is
#      Pages-scoped (Pages:Edit only) and CANNOT create the Hyperdrive config.
#   2. Create the Hyperdrive config pointing at the Supabase session pooler
#      (aws-0-ap-south-1.pooler.supabase.com:5432, user jee_app.<ref>):
#        curl -X POST .../accounts/$ACCOUNT/hyperdrive/config -d '{
#          "name": "jee-nexus-db",
#          "origin": { "database": "postgres", "host": "aws-0-ap-south-1.pooler.supabase.com",
#                      "port": 5432, "scheme": "postgres", "user": "jee_app.kwavmbowgvgphaccrqlc" } }'
#   3. Paste the returned config id into wrangler.jsonc (hyperdrive binding).
#
# THEN this script performs the deploy:
set -eu
cd /home/z/my-project

if [ ! -f .secrets/tokens.env ]; then echo "missing .secrets/tokens.env"; exit 1; fi
. .secrets/tokens.env
export CLOUDFLARE_API_TOKEN="$CF_PAT"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-d847f3e3bffdd74a6df0ecfbf150df31}"

# guard: the Hyperdrive binding must be wired before deploying
if ! grep -q '"hyperdrive"' wrangler.jsonc || grep -q '<hyperdrive-config-id>' wrangler.jsonc; then
  echo "REFUSED: wrangler.jsonc has no Hyperdrive binding configured."
  echo "The API routes need Postgres access — follow the PREREQUISITES in this script."
  exit 1
fi

echo "— building (OpenNext → .open-next/) —"
unset DATABASE_URL
bunx cloudflare build

echo "— deploying worker + assets —"
bunx wrangler deploy

echo "— done. Verify: https://jee-nexus-app.<subdomain>.workers.dev —"
