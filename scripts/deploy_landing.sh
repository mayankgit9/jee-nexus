#!/usr/bin/env bash
# Deploy the static landing page to Cloudflare Pages (reproducible).
set -eu
. /home/z/my-project/.secrets/tokens.env
export CLOUDFLARE_API_TOKEN="$CF_PAT"
cd /home/z/my-project
npx -y wrangler@latest pages deploy landing --project-name=jee-nexus --branch=main --commit-dirty=true
