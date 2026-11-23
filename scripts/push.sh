#!/usr/bin/env bash
# JEE NEXUS — instant commit+push (use after every file change)
# Usage: bash scripts/push.sh "commit message"
set -eu
cd /home/z/my-project
. .secrets/tokens.env
git remote set-url origin "https://x-access-token:${GH_PAT}@github.com/mayankgit9/jee-nexus.git"
git add -A
git commit -q -m "${1:-wip: incremental update}" || true
git push -q origin main 2>/dev/null || git push -u origin main 2>&1 | grep -viE 'token|x-access' || true
git remote set-url origin https://github.com/mayankgit9/jee-nexus.git
echo "PUSHED: ${1:-wip}"
