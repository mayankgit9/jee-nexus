#!/usr/bin/env python3
"""JEE NEXUS — PYQ master pipeline: crawl -> convert -> verify -> commit.
Processes all JEE Main papers 2019-2026 from questions.examside.com.

Resumable: skips papers already fully converted (raw + batch files exist).
Usage:
  python3 scripts/pyq_master.py                 # full run
  python3 scripts/pyq_master.py --limit 3       # only next 3 papers
  python3 scripts/pyq_master.py --commit-every 5
"""
import glob
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pyq_crawl_paper import list_papers, crawl_paper

BATCH_PREFIX = "pyq"
COMMIT_EVERY = int(os.environ.get("COMMIT_EVERY", "2"))


def converted_batches(slug):
    """Batch files already produced for this slug (by any prefix)."""
    return sorted(glob.glob(f"data/questions/*_{slug}.json")) or \
           sorted(glob.glob(f"data/questions/pyq*_{slug.split('jee-main-', 1)[-1][:18]}*.json"))


def run_paper(slug):
    raw_path = f"data/pyq_raw/{slug}.json"
    # 1) crawl (skips already-fetched questions internally)
    n = crawl_paper(slug)
    if n is None:
        return ("CRAWL_FAIL", slug, 0)
    # 2) convert — batch name: pyq + year + sequence within year
    m = None
    import re
    mm = re.match(r"jee-main-(\d{4})-(.*)", slug)
    year, rest = mm.group(1), mm.group(2)
    batch = f"pyq{year}-{rest[:40]}"
    r = subprocess.run([sys.executable, "scripts/pyq_convert_paper.py", slug, batch],
                       capture_output=True, text=True, timeout=1800)
    out = r.stdout.strip().splitlines()
    nq = 0
    for line in out:
        if "STATS" in line:
            try:
                stats = json.loads(line.split("STATS", 1)[1].replace("'", '"').replace("None", "null"))
                nq = stats.get("questions", 0)
            except Exception:
                nq = -1
    if r.returncode != 0:
        print("CONVERT STDERR:", r.stderr[-500:])
        return ("CONVERT_FAIL", slug, n)
    # 3) verify
    v = subprocess.run([sys.executable, "scripts/verify_pyq_batch.py", batch],
                       capture_output=True, text=True)
    tail = [l for l in v.stdout.strip().splitlines() if l.startswith("RESULT")]
    print(f"  verify: {tail[0] if tail else '?'}")
    if v.returncode != 0:
        print(v.stdout[-800:])
        return ("VERIFY_FAIL", slug, nq)
    return ("OK", slug, nq)


def main():
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    papers = list_papers()
    print(f"papers discovered: {len(papers)}")
    # deterministic order: oldest first (2019 -> 2026)
    papers.sort(key=lambda p: (p["year"], p.get("date") or ""))
    done = 0
    fails = []
    since_commit = 0
    t0 = time.time()
    state_path = "data/pyq_raw/_completed.json"
    completed = set()
    if os.path.exists(state_path):
        try:
            completed = set(json.load(open(state_path)))
        except Exception:
            completed = set()
    for p in papers:
        slug = p["key"]
        if slug in completed:
            continue
        raw = f"data/pyq_raw/{slug}.json"
        if os.path.exists(raw):
            try:
                d = json.load(open(raw))
                have = {q["question_id"] for q in d["questions"]}
                expect = set()
                for ids in d["subjects"].values():
                    expect.update(ids)
                if have == expect and expect:
                    # fully crawled; check converted
                    m = glob.glob(f"data/questions/*{slug.replace('jee-main-', '')[:20]}*.json")
                    # cheap check: skip only if a batch json mentions this slug's qids
                    pass
            except Exception:
                pass
        status, s, nq = run_paper(slug)
        done += 1
        print(f"[{done}/{len(papers)}] {status} {s} ({nq} q) "
              f"elapsed={int(time.time()-t0)}s")
        if status == "OK":
            completed.add(slug)
            json.dump(sorted(completed), open(state_path, "w"))
        if status != "OK":
            fails.append((status, s))
        since_commit += 1
        if since_commit >= COMMIT_EVERY:
            total_q = sum(
                len(json.load(open(f)))
                for f in glob.glob("data/questions/pyq*.json")
            )
            subprocess.run(["bash", "scripts/push.sh",
                            f"feat(M14): PYQ bulk — {len(completed)}/{len(papers)} papers, "
                            f"{total_q} questions total; latest {s} ({nq} q)"],
                           capture_output=True, text=True, timeout=180)
            since_commit = 0
        if limit and done >= limit:
            break
    print(f"\nDONE: {done} papers, {len(fails)} failures")
    for f in fails:
        print("  FAIL:", f)


if __name__ == "__main__":
    main()
