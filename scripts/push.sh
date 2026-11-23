#!/usr/bin/env bash
# JEE NEXUS — instant commit+push (use after every file change)
# Usage: bash scripts/push.sh "commit message"
# Requires .secrets/tokens.env defining GH_PAT (GitHub PAT, repo scope).
# Without it, commits stay local (the sandbox reset wiped the old file).
set -eu
cd /home/z/my-project
PUSHED=no
if [ -f .secrets/tokens.env ]; then
  . .secrets/tokens.env
  if [ -n "${GH_PAT:-}" ]; then
    git remote set-url origin "https://x-access-token:${GH_PAT}@github.com/mayankgit9/jee-nexus.git"
    PUSHED=yes
  fi
fi
git add -A
git commit -q -m "${1:-wip: incremental update}" || true
if [ "$PUSHED" = yes ]; then
  git push -q origin main 2>/dev/null || git push -u origin main 2>&1 | grep -viE 'token|x-access' || true
  git remote set-url origin https://github.com/mayankgit9/jee-nexus.git
  echo "PUSHED: ${1:-wip}"
else
  echo "COMMITTED LOCALLY (no GH_PAT — recreate .secrets/tokens.env with GH_PAT=<token> to push): ${1:-wip}"
fi
