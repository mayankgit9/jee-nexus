#!/usr/bin/env bash
# JEE NEXUS — one-shot resume after .secrets/ is re-provisioned.
# The 2026-11-25 session finished M24 (community chat) locally with all tests
# green, but push + migration + deploy were blocked: sandbox recycle wiped
# .secrets/ again. When tokens are back, run this script top to bottom.
#
# Expects .secrets/ with: tokens.env (GH_PAT, SB_PAT), cloudflare.env
# (CLOUDFLARE_API_TOKEN, ACCOUNT_ID), supabase_db.env (SUPABASE_DB_PASSWORD...).
set -euo pipefail
cd /home/z/my-project

echo "== 1. push main =="
git push origin main

echo "== 2. apply chat migration 0007 to prod (preparena) =="
python3 scripts/apply_migration.py supabase/migrations/0007_chat.sql

echo "== 3. deploy to Cloudflare Workers =="
set -a; source .secrets/cloudflare.env; set +a
bunx wrangler deploy

echo "== 4. verify live =="
B=https://jee-nexus-app.jee-nexus.workers.dev
for ep in / /api/pyq /api/taxonomy; do
  curl -s -o /dev/null -w "$ep -> %{http_code}\n" "$B$ep"
done
# chat routes: expect 401 (auth guard) once deployed, 503 (P2021) if migration missed
for ep in /api/chat/conversations /api/chat/users; do
  curl -s -o /dev/null -w "$ep -> %{http_code} (401 = deployed OK; 503 = migration missing; 404 = deploy did not land)\n" "$B$ep"
done

echo "== 5. done — browser-check /#/community on the live site =="
