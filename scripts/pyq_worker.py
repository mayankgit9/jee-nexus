#!/usr/bin/env python3
"""JEE NEXUS — PYQ worker: process an explicit list of papers
(crawl -> convert -> verify). Designed for parallel agents: NO shared-state
writes (no _completed.json), NO git commits — the orchestrator merges state
and commits centrally after each wave.

Usage:
  python3 scripts/pyq_worker.py slug1 slug2 ... [--limit N]
  python3 scripts/pyq_worker.py --year 2020          # all remaining of a year
  python3 scripts/pyq_worker.py --next N             # next N oldest remaining
"""
import glob
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pyq_crawl_paper import list_papers, crawl_paper

STATE = "data/pyq_raw/_completed.json"


def completed_slugs():
    if os.path.exists(STATE):
        try:
            return set(json.load(open(STATE)))
        except Exception:
            return set()
    return set()


def pick(args):
    if "--year" in args:
        year = args[args.index("--year") + 1]
        comp = completed_slugs()
        return [p["key"] for p in list_papers()
                if p["key"].startswith(f"jee-main-{year}-") and p["key"] not in comp]
    if "--next" in args:
        n = int(args[args.index("--next") + 1])
        comp = completed_slugs()
        papers = [p["key"] for p in list_papers() if p["key"] not in comp]
        papers.sort()  # 2019 -> 2026
        return papers[:n]
    return [a for a in args if not a.startswith("--")]


def run_paper(slug):
    n = crawl_paper(slug)
    if n is None:
        return ("CRAWL_FAIL", slug, 0, 0)
    mm = re.match(r"jee-main-(\d{4})-(.*)", slug)
    year, rest = mm.group(1), mm.group(2)
    batch = f"pyq{year}-{rest[:40]}"
    r = subprocess.run([sys.executable, "scripts/pyq_convert_paper.py", slug, batch],
                       capture_output=True, text=True, timeout=1800)
    nq = 0
    for line in r.stdout.strip().splitlines():
        if "STATS" in line:
            # format: "STATS <slug>: {dict}" — strip the slug prefix
            payload = line.split("STATS", 1)[1]
            payload = payload[payload.find("{"):]
            try:
                stats = json.loads(payload.replace("'", '"').replace("None", "null"))
                nq = stats.get("questions", 0)
            except Exception:
                nq = -1
    if r.returncode != 0:
        return ("CONVERT_FAIL", slug, n, nq)
    v = subprocess.run([sys.executable, "scripts/verify_pyq_batch.py", batch],
                       capture_output=True, text=True)
    ok = v.returncode == 0
    if not ok:
        print("  VERIFY OUTPUT:", v.stdout[-600:])
    return ("OK" if ok else "VERIFY_FAIL", slug, n, nq)


def main():
    slugs = pick(sys.argv[1:])
    print(f"worker assigned {len(slugs)} papers", flush=True)
    results = []
    for i, slug in enumerate(slugs, 1):
        status, s, nraw, nq = run_paper(slug)
        print(f"[{i}/{len(slugs)}] {status} {s} (raw {nraw}, converted {nq})", flush=True)
        results.append({"slug": s, "status": status, "questions": nq})
    ok = sum(1 for r in results if r["status"] == "OK")
    out = f"data/pyq_raw/_worker_{os.getpid()}.json"
    json.dump(results, open(out, "w"), indent=1)
    print(f"WORKER DONE: {ok}/{len(results)} OK — results in {out}", flush=True)


if __name__ == "__main__":
    main()
