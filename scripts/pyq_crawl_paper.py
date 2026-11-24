#!/usr/bin/env python3
"""JEE NEXUS — PYQ crawler for questions.examside.com (ExamGoal).

Pipeline stage 1: fetch all question data for one paper.
  - paper page __data.json -> question ids grouped by subject
  - question pages return 4 consecutive questions each; fetch every 4th id
  - dedupe by question_id, store raw JSON per paper under data/pyq_raw/

Usage: python3 scripts/pyq_crawl_paper.py <paper-slug> [--papers]
       python3 scripts/pyq_crawl_paper.py --list           # list all paper slugs 2019-2026
"""
import json
import os
import re
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from devalue import load_data_json

BASE = "https://questions.examside.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-IN,en;q=0.9",
}
RAW_DIR = "data/pyq_raw"
DELAY = 0.35  # polite delay between requests


def get(url, tries=3, delay=DELAY):
    for i in range(tries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=45)
            if r.status_code == 200:
                return r
            if r.status_code == 404:
                return None
            print(f"  HTTP {r.status_code} {url}", file=sys.stderr)
        except Exception as e:
            print(f"  err {i+1}: {e}", file=sys.stderr)
        time.sleep(delay * (i + 2))
    return None


def list_papers():
    """All JEE Main paper slugs from the year-wise index."""
    r = get(f"{BASE}/past-years/year-wise/jee/jee-main/__data.json")
    if r is None:
        sys.exit("cannot fetch year-wise index")
    nodes = load_data_json(r.text)
    # find node with papers list; year-wise index groups by year: [{title: '2026', papers: [...]}]
    for n in nodes:
        if not (isinstance(n, dict) and isinstance(n.get("papers"), list)):
            continue
        papers = []
        groups = n["papers"]
        if groups and isinstance(groups[0], dict) and "papers" in groups[0]:
            for grp in groups:
                papers.extend(grp["papers"])
        else:
            papers = groups
        out = []
        for p in papers:
            key = p.get("key", "")
            m = re.match(r"jee-main-(\d{4})", key)
            if m and 2019 <= int(m.group(1)) <= 2026:
                out.append({
                    "key": key,
                    "title": p.get("title"),
                    "date": p.get("date"),
                    "year": p.get("year"),
                    "languages": p.get("languages"),
                    "isMemoryBased": p.get("isMemoryBased"),
                    "isOnline": p.get("isOnline"),
                })
        return out
    sys.exit("papers list not found in index")


def crawl_paper(slug, outdir=RAW_DIR):
    """Fetch all questions of one paper. Returns count."""
    os.makedirs(outdir, exist_ok=True)
    paper_url = f"{BASE}/past-years/year-wise/jee/jee-main/{slug}"
    r = get(f"{paper_url}/__data.json")
    if r is None:
        print(f"PAPER FETCH FAILED: {slug}")
        return None
    nodes = load_data_json(r.text)
    pnode = None
    for n in nodes:
        if isinstance(n, dict) and isinstance(n.get("questions"), list):
            pnode = n
            break
    if pnode is None:
        print(f"no question groups in {slug}")
        return None

    groups = pnode["questions"]  # [{_id: subject, questions: [{question_id, content}]}]
    meta = {
        "slug": slug,
        "title": pnode.get("title"),
        "paper": pnode.get("paper"),
        "subjects": {},
    }
    all_ids = []  # ordered (subject, id)
    for g in groups:
        subj = g["_id"]
        ids = [q["question_id"] for q in g["questions"]]
        meta["subjects"][subj] = ids
        all_ids.extend((subj, qid) for qid in ids)

    out_path = os.path.join(outdir, f"{slug}.json")
    if os.path.exists(out_path):
        existing = json.load(open(out_path))
        have = {q["question_id"] for q in existing["questions"]}
    else:
        existing = {"slug": slug, "title": meta["title"], "paper": meta["paper"],
                    "subjects": meta["subjects"], "questions": []}
        have = set()

    # fetch every question id we don't have (pages return 4 consecutive)
    fetched = 0
    ordered_ids = [qid for _, qid in all_ids]
    i = 0
    while i < len(ordered_ids):
        qid = ordered_ids[i]
        if qid in have:
            i += 1
            continue
        # find which subject group this id belongs to for the URL? URL doesn't need subject.
        qr = get(f"{paper_url}/{qid}/__data.json")
        fetched += 1
        if qr is not None:
            try:
                qnodes = load_data_json(qr.text)
            except Exception as e:
                print(f"  decode fail {qid}: {e}", file=sys.stderr)
                i += 1
                continue
            for qn in qnodes:
                if isinstance(qn, dict) and isinstance(qn.get("questions"), list):
                    for q in qn["questions"]:
                        qid2 = q.get("question_id")
                        if qid2 and qid2 not in have:
                            existing["questions"].append(q)
                            have.add(qid2)
                    # skip ahead: we got up to 4 consecutive from position i
                    got = [q.get("question_id") for q in qn["questions"]]
                    # advance i while the next id was fetched
                    while i < len(ordered_ids) and ordered_ids[i] in got:
                        i += 1
                    # back up one to be safe (pages might overlap oddly)
                    if i > 0 and ordered_ids[i - 1] in got:
                        pass
                    continue
        else:
            i += 1
        if fetched % 20 == 0:
            json.dump(existing, open(out_path, "w"))
            print(f"  ... {fetched} requests, {len(existing['questions'])} questions")

    json.dump(existing, open(out_path, "w"))
    print(f"DONE {slug}: {len(existing['questions'])} questions ({fetched} requests)")
    return len(existing["questions"])


if __name__ == "__main__":
    if "--list" in sys.argv:
        papers = list_papers()
        print(json.dumps(papers, indent=1))
        sys.exit(0)
    if "--papers" in sys.argv:
        papers = list_papers()
        # crawl all 2019-2026 in order
        for p in papers:
            crawl_paper(p["key"])
        sys.exit(0)
    slug = sys.argv[1]
    crawl_paper(slug)
