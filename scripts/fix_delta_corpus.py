#!/usr/bin/env python3
"""Corpus-side \\Delta<letter> LaTeX repair.

KaTeX renders unknown commands (\\DeltaG etc.) as red error text. This
rewrites every "\\Delta<letter>" -> "\\Delta <letter>" in question text,
options and solution bodies across all PYQ corpus files. Run together
with the matching DB update (scripts/fix_delta_db.sql via db_query.py)
so contentHash values stay in sync on both sides.
"""
import glob
import json
import re

DELTA_RE = re.compile(r'\\Delta([A-Za-z])')

changed_files = 0
changed_rows = 0
for fp in sorted(glob.glob('data/questions/pyq*.json')):
    rows = json.load(open(fp))
    changed = False
    for q in rows:
        hit = False
        if q.get('text') and DELTA_RE.search(q['text']):
            q['text'] = DELTA_RE.sub(r'\\Delta \1', q['text'])
            hit = True
        opts = q.get('options')
        if isinstance(opts, list):
            for i, o in enumerate(opts):
                t = o if isinstance(o, str) else o.get('text')
                if t and DELTA_RE.search(t):
                    if isinstance(o, str):
                        opts[i] = DELTA_RE.sub(r'\\Delta \1', o)
                    else:
                        o['text'] = DELTA_RE.sub(r'\\Delta \1', t)
                    hit = True
        sol = q.get('solution')
        if sol and sol.get('body') and DELTA_RE.search(sol['body']):
            sol['body'] = DELTA_RE.sub(r'\\Delta \1', sol['body'])
            hit = True
        if hit:
            changed = True
            changed_rows += 1
    if changed:
        with open(fp, 'w') as f:
            json.dump(rows, f, indent=1, ensure_ascii=False)
        changed_files += 1

print(f'repaired {changed_rows} rows across {changed_files} files')

# post-check: no artifacts remain anywhere
left = 0
for fp in sorted(glob.glob('data/questions/pyq*.json')):
    for q in json.load(open(fp)):
        blob = q.get('text', '') + json.dumps(q.get('options') or [], ensure_ascii=False) + (q.get('solution') or {}).get('body', '')
        if DELTA_RE.search(blob):
            left += 1
print(f'artifacts remaining: {left}')
assert left == 0, 'artifact repair incomplete'
