#!/usr/bin/env bash
# Deploy the static landing page to Cloudflare Pages (reproducible).
set -eu
cd /home/z/my-project
if [ ! -f .secrets/cloudflare.env ]; then
  echo "missing .secrets/cloudflare.env (needs CLOUDFLARE_API_TOKEN=...)"
  exit 1
fi
set -a
. .secrets/cloudflare.env
set +a
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN not set in .secrets/cloudflare.env}"
npx -y wrangler@latest pages deploy landing --project-name=jee-nexus --branch=main --commit-dirty=true
