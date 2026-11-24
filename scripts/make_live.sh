#!/usr/bin/env bash
# JEE NEXUS — "make everything live" in one command.
# Uses whichever credentials exist in .secrets/:
#   .secrets/tokens.env      GH_PAT=<github PAT, repo scope>
#   .secrets/cloudflare.env  CLOUDFLARE_API_TOKEN=<workers scripts:edit>
#                            CLOUDFLARE_ACCOUNT_ID=<optional, default below>
#
# What it does, in order:
#   1. GH_PAT    -> push all local commits + dispatch the import-pyq workflow
#                   (imports every real PYQ batch into the live Supabase DB
#                   using the repo's DATABASE_URL secret)
#   2. CF token  -> deploy the latest app to Cloudflare Workers
#
# Missing credentials are reported clearly at the end.
set -u
cd /home/z/my-project

REPO="mayankgit9/jee-nexus"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-d847f3e3bffdd74a6df0ecfbf150df31}"

GH_PAT=""
CF_TOKEN=""
[ -f .secrets/tokens.env ] && . .secrets/tokens.env
[ -f .secrets/cloudflare.env ] && . .secrets/cloudflare.env
GH_PAT="${GH_PAT:-}"
CF_TOKEN="${CLOUDFLARE_API_TOKEN:-}"

echo "=== 1/2 GitHub: push + trigger live PYQ import ==="
if [ -n "$GH_PAT" ]; then
  git remote set-url origin "https://x-access-token:${GH_PAT}@github.com/${REPO}.git"
  if git push -q origin main 2>/dev/null || git push -u origin main 2>&1 | grep -viE 'token|x-access'; then
    echo "PUSHED: $(git rev-list --count origin/main) commits now on GitHub"
  else
    echo "WARNING: push failed"
  fi
  git remote set-url origin "https://github.com/${REPO}.git"
  echo "Dispatching import-pyq workflow (live DB import, confirm=IMPORT)..."
  HTTP=$(curl -s -o /tmp/wf_dispatch.json -w "%{http_code}" -X POST \
    -H "Authorization: Bearer ${GH_PAT}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${REPO}/actions/workflows/import-pyq.yml/dispatches" \
    -d '{"ref":"main","inputs":{"confirm":"IMPORT"}}')
  if [ "$HTTP" = "204" ]; then
    echo "WORKFLOW DISPATCHED: https://github.com/${REPO}/actions/workflows/import-pyq.yml"
  else
    echo "Workflow dispatch failed (HTTP $HTTP):"
    head -c 300 /tmp/wf_dispatch.json; echo
  fi
else
  echo "SKIPPED: no GH_PAT in .secrets/tokens.env"
fi

echo ""
echo "=== 2/2 Cloudflare: deploy latest app ==="
if [ -n "$CF_TOKEN" ]; then
  bash scripts/deploy_app_cloudflare.sh
else
  echo "SKIPPED: no CLOUDFLARE_API_TOKEN in .secrets/cloudflare.env"
fi

echo ""
echo "=== summary ==="
[ -n "$GH_PAT" ]    && echo "github push + live import: DONE"    || echo "github push + live import: BLOCKED (add GH_PAT to .secrets/tokens.env)"
[ -n "$CF_TOKEN" ]  && echo "cloudflare app deploy:    DONE"     || echo "cloudflare app deploy:    BLOCKED (add CLOUDFLARE_API_TOKEN to .secrets/cloudflare.env)"
echo "live site: https://jee-nexus-app.jee-nexus.workers.dev"
