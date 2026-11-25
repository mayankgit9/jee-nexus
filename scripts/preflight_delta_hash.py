#!/usr/bin/env python3
"""Pre-flight check for the \\Delta DB repair:
1. compute the expected post-fix contentHash for every affected corpus row
   (same normalization as TS computeContentHash),
2. show what the SQL expression produces for ONE row (run separately
   via db_query.py) so both sides can be compared before the UPDATE.
"""
import glob
import hashlib
import json
import re

DELTA_RE = re.compile(r'\\Delta([A-Za-z])')


def ts_hash(text: str, subject_key: str) -> str:
    """Mirror src/lib/questions.ts computeContentHash exactly."""
    normalized = text.lower()
    normalized = re.sub(r'\s+', ' ', normalized)
    normalized = re.sub(r'[$\\{}]', '', normalized)
    normalized = normalized.strip()
    return hashlib.sha256(f'{subject_key}::{normalized}'.encode()).hexdigest()


affected = []
for fp in sorted(glob.glob('data/questions/pyq*.json')):
    for q in json.load(open(fp)):
        if q.get('text') and DELTA_RE.search(q['text']):
            fixed = DELTA_RE.sub(r'\\Delta \1', q['text'])
            affected.append({
                'publicId': q['publicId'],
                'oldHash': ts_hash(q['text'], q['subjectKey']),
                'newHash': ts_hash(fixed, q['subjectKey']),
            })

print(f'affected rows (text artifact): {len(affected)}')
for a in affected:
    print(f"  {a['publicId']}  old={a['oldHash'][:16]}…  new={a['newHash']}")
with open('/tmp/delta_expected_hashes.json', 'w') as f:
    json.dump(affected, f, indent=1)
print('saved /tmp/delta_expected_hashes.json')
