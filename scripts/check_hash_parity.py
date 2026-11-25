#!/usr/bin/env python3
"""Corpus <-> DB content_hash parity check.

Computes the contentHash for every corpus question (same normalization as
TS computeContentHash), fetches all DB content_hashes, and diffs the two
sets. A 100% match proves: (a) the Delta repair applied identically on
both sides, and (b) a future re-import would skip everything (no drift,
no accidental duplicate inserts).
"""
import glob
import hashlib
import json
import re
import subprocess
import sys

REF = "mxfiazcjcgqzqynmsefp"


def ts_hash(text: str, subject_key: str) -> str:
    normalized = re.sub(r'\s+', ' ', text.lower())
    normalized = re.sub(r'[$\\{}]', '', normalized).strip()
    return hashlib.sha256(f'{subject_key}::{normalized}'.encode()).hexdigest()


# corpus side
corpus_by_hash = {}
for fp in sorted(glob.glob('data/questions/pyq*.json')):
    for q in json.load(open(fp)):
        h = ts_hash(q['text'], q['subjectKey'])
        corpus_by_hash.setdefault(h, []).append(q['publicId'])

# DB side
with open('/home/z/my-project/.secrets/tokens.env') as f:
    pat = [l.split('=', 1)[1].strip() for l in f if l.startswith('SB_PAT=')][0]

sql = "select public_id, content_hash from questions"
r = subprocess.run(
    ['curl', '-sS', '-m', '120', '-X', 'POST',
     '-H', f'Authorization: Bearer {pat}',
     '-H', 'Content-Type: application/json',
     f'https://api.supabase.com/v1/projects/{REF}/database/query',
     '-d', json.dumps({'query': sql})],
    capture_output=True, text=True)
rows = json.loads(r.stdout)
if not isinstance(rows, list):
    print('DB QUERY FAILED:', str(rows)[:300])
    sys.exit(1)

db_by_hash = {}
for row in rows:
    db_by_hash[row['content_hash']] = row['public_id']

corpus_set = set(corpus_by_hash)
db_set = set(db_by_hash)

only_corpus = corpus_set - db_set
only_db = db_set - corpus_set

print(f'corpus unique hashes: {len(corpus_set)}')
print(f'db rows:              {len(rows)} (unique hashes: {len(db_set)})')
print(f'hashes only in corpus (would re-import): {len(only_corpus)}')
for h in list(only_corpus)[:10]:
    print('   corpus:', corpus_by_hash[h][:3])
print(f'hashes only in db (orphaned vs corpus): {len(only_db)}')
for h in list(only_db)[:10]:
    print('   db:', db_by_hash[h])

# also verify hash->publicId agreement where both sides have the hash
mismatched_ids = 0
for h in corpus_set & db_set:
    if db_by_hash[h] not in corpus_by_hash[h]:
        mismatched_ids += 1
print(f'hash matches with differing publicId: {mismatched_ids}')

ok = not only_corpus and not only_db and len(corpus_set) == len(rows)
print('PARITY:', 'OK' if ok else 'MISMATCH')
sys.exit(0 if ok else 1)
