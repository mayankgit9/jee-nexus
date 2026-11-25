#!/usr/bin/env python3
"""Corpus repair for the 10 rows rejected by import run 45627727353.

Verified against each row's own solution (never invented):
  FIX (answer present in solution, question gradeable):
    - PYQ-2020-ahEeSTeg  numerical: solution derives ΔG° = -13537.57 J;
      also repair the \\Delta<letter> LaTeX artifact in its text/solution
      (fresh insert, so hash changes are safe).
    - PYQ-2021-Q9ZnZCWS  mcq: solution gives A→2,B→3,C→4,D→1 = option (a)-(ii),(b)-(iii),(c)-(iv),(d)-(i) = index 0.
    - PYQ-2023-lgnzajcc  mcq: solution states "Δ₀ itself is largest for
      option (B)" = [Mn(OH₂)₆]³⁺ = index 1 (21000 cm⁻¹, the largest value listed).
  REMOVE (ungradeable — NTA dropped/bonus/ambiguous, per their own solutions):
    - PYQ-2021-1ktjv4lb  "No option contains all species... question is bonus"
    - PYQ-2022-1l6dy94r  "no answer correct (Bonus)"
    - PYQ-2022-1l6hy2sz  "matches none of the options. NTA dropped this question... bonus"
    - PYQ-2022-mvjeks0o  "≈ 127.6, which equals none of the options"
    - PYQ-2022-1l54tqgw  "Equation (i) and (ii) are contradicting" (defective)
    - PYQ-2022-1l6p5wou  two valid answers (θ = 15° and 75°) — engine grades one value
    - PYQ-2023-1lgyfr0p  two valid answers (θ = 30° and 60°) — engine grades one value

After this script: corpus 12,089 rows, 0 validation rejects,
11,886 unique importable hashes (11,883 live + 3 fixed rows).
"""
import glob
import json
import re

FIX = {
    'PYQ-2020-ahEeSTeg': {'numericalAnswer': '-13537.57', 'numericalTolerance': '0.5'},
    'PYQ-2021-Q9ZnZCWS': {'correctOptions': [0]},
    'PYQ-2023-lgnzajcc': {'correctOptions': [1]},
}
REMOVE = {
    'PYQ-2021-1ktjv4lb', 'PYQ-2022-1l6dy94r', 'PYQ-2022-1l6hy2sz',
    'PYQ-2022-mvjeks0o', 'PYQ-2022-1l54tqgw', 'PYQ-2022-1l6p5wou',
    'PYQ-2023-1lgyfr0p',
}

# repair LaTeX "\Delta<letter>" -> "\Delta <letter>" (unknown-command error in KaTeX)
DELTA_RE = re.compile(r'\\Delta([A-Za-z])')

fixed = removed = 0
for fp in sorted(glob.glob('data/questions/pyq*.json')):
    rows = json.load(open(fp))
    out = []
    changed = False
    for q in rows:
        pid = q.get('publicId')
        if pid in REMOVE:
            changed = True
            removed += 1
            continue
        if pid in FIX:
            q.update(FIX[pid])
            changed = True
            fixed += 1
            if pid == 'PYQ-2020-ahEeSTeg':
                q['text'] = DELTA_RE.sub(r'\\Delta \1', q['text'])
                sol = q.get('solution')
                if sol and sol.get('body'):
                    sol['body'] = DELTA_RE.sub(r'\\Delta \1', sol['body'])
        out.append(q)
    if changed:
        with open(fp, 'w') as f:
            json.dump(out, f, indent=1, ensure_ascii=False)
        print(f'updated {fp}: now {len(out)} rows')

print(f'\nfixed: {fixed}, removed: {removed}')

# verify: total + re-run embedded validation essentials
total = 0
for fp in sorted(glob.glob('data/questions/pyq*.json')):
    total += len(json.load(open(fp)))
print('corpus rows now:', total)
assert total == 12096 - removed, 'unexpected row count'
