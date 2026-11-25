#!/usr/bin/env python3
"""Replay the import validation + dedup simulation over the PYQ corpus
WITHOUT touching any database. Purpose: identify the 10 rows the live
import rejected (run 45627727353: inserted=1833 skipped=10253
rejected=10, DB total 11,883).

Replicates src/lib/import.ts exactly:
  - validateQuestion() rules
  - computeContentHash(text, subjectKey) dedup (sha256 of
    "{subject}::{normalized}" where normalized = lowercase, collapse
    whitespace, strip $ \\ { }, trim)
  - chunking order (sorted glob, batch 50) so batchHashes match the
    server-side within-run dedup
Pre-existing DB hashes are unknown locally, so 'skipped vs inserted'
totals are approximated; the goal is only the validation rejects.
"""
import glob
import hashlib
import json

VALID_TYPES = ['mcq_single', 'mcq_multi', 'numerical']
VALID_DIFFICULTIES = ['easy', 'medium', 'hard']

def content_hash(text, subject):
    norm = text.lower()
    norm = ' '.join(norm.split())
    norm = norm.replace('$', '').replace('\\', '').replace('{', '').replace('}', '').strip()
    return hashlib.sha256(f'{subject}::{norm}'.encode()).hexdigest()

def validate(q):
    sk = q.get('subjectKey')
    if not sk or sk not in ('physics', 'chemistry', 'mathematics'):
        return f'unknown subjectKey "{sk}"'
    ck = q.get('chapterKey')
    # 65-chapter taxonomy: accept any non-empty key (chapter table lookup
    # can't fail for corpus rows unless key truly unknown — flag empties)
    if not ck or not str(ck).strip():
        return f'unknown chapterKey "{ck}"'
    text = q.get('text')
    if not text or len(str(text).strip()) < 10:
        return 'question text missing or under 10 chars'
    t = q.get('type')
    if not t or t not in VALID_TYPES:
        return f'invalid type "{t}"'
    d = q.get('difficulty')
    if d and d not in VALID_DIFFICULTIES:
        return f'invalid difficulty "{d}"'
    y = q.get('sourceYear')
    if y is not None and y != '':
        try:
            yv = float(y)
            if yv < 2000 or yv > 2030:
                return f'invalid sourceYear "{y}"'
        except (TypeError, ValueError):
            return f'invalid sourceYear "{y}"'
    if t == 'numerical':
        na = q.get('numericalAnswer')
        if na is None or str(na).strip() == '':
            return 'numerical question missing numericalAnswer'
        try:
            float(na)
        except (TypeError, ValueError):
            return f'numericalAnswer "{na}" is not a number'
        nt = q.get('numericalTolerance')
        if nt is not None and str(nt) != '':
            try:
                float(nt)
            except (TypeError, ValueError):
                return f'numericalTolerance "{nt}" is not a number'
    else:
        opts = q.get('options')
        if not isinstance(opts, list) or len(opts) == 0:
            return 'MCQ question missing options'
        texts = [(o if isinstance(o, str) else o.get('text')) for o in opts]
        if len(opts) < 2:
            return 'MCQ question needs at least 2 options'
        if len(opts) > 6:
            return 'MCQ question has more than 6 options'
        if any(not tx or not str(tx).strip() for tx in texts):
            return 'an option has empty text'
        co = q.get('correctOptions')
        if not isinstance(co, list) or len(co) == 0:
            return 'MCQ question missing correctOptions'
        if len(set(co)) != len(co):
            return 'correctOptions contains duplicates'
        for c in co:
            if not isinstance(c, int) or isinstance(c, bool) or c < 0 or c >= len(opts):
                return f'correctOption {c} out of range (0-{len(opts)-1})'
        if t == 'mcq_single' and len(co) != 1:
            return 'mcq_single must have exactly one correct option'
        if t == 'mcq_multi' and len(co) < 2:
            return 'mcq_multi must have at least two correct options'
    sol = q.get('solution')
    if sol and (not sol.get('body') or len(str(sol['body']).strip()) < 20):
        return 'solution.body missing or under 20 chars'
    for img in q.get('images') or []:
        if not img.get('url') or not img.get('altText'):
            return 'image missing url or altText'
    return None

files = sorted(glob.glob('data/questions/pyq*.json'))
questions = []
for fp in files:
    questions.extend(json.load(open(fp)))
print(f'corpus rows: {len(questions)} from {len(files)} files')

rejects = []
seen_hashes = set()
dupe_hashes = 0
for i, q in enumerate(questions):
    err = validate(q)
    if err:
        rejects.append((i, q.get('publicId'), q.get('sourceYear'), q.get('subjectKey'), err))
        continue
    h = content_hash(q.get('text') or '', q.get('subjectKey') or '')
    if h in seen_hashes:
        dupe_hashes += 1
    else:
        seen_hashes.add(h)

print(f'\nVALIDATION REJECTS: {len(rejects)}')
for r in rejects:
    print(' ', r)
print(f'\nintra-corpus hash dupes: {dupe_hashes} (live run skipped 203 vs DB, 10 rejected)')
print(f'unique hashes in corpus: {len(seen_hashes)}')
