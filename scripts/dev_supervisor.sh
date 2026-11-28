#!/usr/bin/env bash
# Dev server supervisor — auto-restarts next dev if it dies (OOM etc).
cd /home/z/my-project
while true; do
  bun run dev >> dev-supervised.log 2>&1
  echo "[supervisor] dev exited at $(date), restarting in 3s..." >> dev-supervised.log
  sleep 3
done
