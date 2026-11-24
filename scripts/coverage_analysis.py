#!/usr/bin/env python3
"""JEE NEXUS — chapter/year coverage analysis across question batches.

Reports which taxonomy chapters are used by each batch file, which remain
untouched, and the PYQ year grid — used to plan the next batch.
Usage: python3 scripts/coverage_analysis.py
"""
import glob
import json
import os
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(__file__), "..")
tax = json.load(open(os.path.join(ROOT, "data/taxonomy.json")))
all_chapters = {s["key"]: {c["key"]: c["name"] for c in s["chapters"]} for s in tax["subjects"]}

used = defaultdict(set)   # chapter_key -> set of batch files
years = defaultdict(int)  # year -> question count
per_batch = {}

for f in sorted(glob.glob(os.path.join(ROOT, "data/questions/batch*_*.json"))):
    qs = json.load(open(f))
    name = os.path.basename(f)
    per_batch[name] = len(qs)
    for q in qs:
        used[q["chapterKey"]].add(name)
        years[q["sourceYear"]] += 1

total_unused = 0
for subj_key, chapters in all_chapters.items():
    unused = [f"{k}" for k, name in chapters.items() if k not in used]
    used_n = len(chapters) - len(unused)
    total_unused += len(unused)
    print(f"== {subj_key}: {used_n}/{len(chapters)} chapters used ==")
    for k in unused:
        print(f"  unused: {k}  ({chapters[k]})")
print()
print("batch files:", per_batch)
print("year grid:", dict(sorted(years.items())))
print("total unused chapters:", total_unused)
