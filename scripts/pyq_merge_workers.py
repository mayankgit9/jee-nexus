#!/usr/bin/env python3
"""JEE NEXUS — merge pyq_worker results into shared state (_completed.json).

The worker is designed for parallel agents: it never writes shared state.
This (the orchestrator side) merges every data/pyq_raw/_worker_*.json with
status OK into _completed.json and removes the consumed worker files.
"""
import glob
import json
import os

STATE = "data/pyq_raw/_completed.json"

completed = set(json.load(open(STATE))) if os.path.exists(STATE) else set()
before = len(completed)
merged = 0

for wf in sorted(glob.glob("data/pyq_raw/_worker_*.json")):
    try:
        results = json.load(open(wf))
    except Exception as e:
        print(f"skip unreadable {wf}: {e}")
        continue
    for r in results:
        if r.get("status") == "OK" and r.get("slug"):
            if r["slug"] not in completed:
                completed.add(r["slug"])
                merged += 1
    os.remove(wf)
    print(f"merged {wf}: {sum(1 for r in results if r['status'] == 'OK')} results")

json.dump(sorted(completed), open(STATE, "w"), indent=1)
print(f"completed: {before} -> {len(completed)} (+{merged})")
