# Contributing to JEE NEXUS

Thanks for helping build a better free JEE Main practice platform.

## Development setup

```bash
git clone https://github.com/mayankgit9/jee-nexus.git
cd jee-nexus
bun install
cp .env.example .env          # fill in values
bun run db:push               # sync the SQLite dev schema
bunx tsx scripts/seed.ts      # seed taxonomy + dev question bank
bun run dev                   # dev server on :3000
```

## Ground rules (non-negotiable)

1. **Never fabricate educational content.** Every question must trace to a real source with
   year/shift metadata. Every answer must be verifiable — numerically where possible.
   Never claim a question is *verified* unless a human expert checked it.
2. **Never commit secrets.** `.env`, `.secrets/`, and the dev database are gitignored — keep them
   that way. Push protection is active; leaked tokens force history rewrites.
3. **Answers never ship to the client.** Grading is server-side. Question payloads must not
   include correct options or numerical answers.
4. **Exam timers are server-authoritative.** The client may trigger auto-submit, but deadlines and
   grading live in the database.
5. **Push small and often.** One file changed → one commit → push. (A sandbox recycle once cost
   us an uncommitted milestone; don't repeat it.)

## Question data format

Questions live in `data/questions/*.json` and are validated by `src/lib/import.ts`:

```json
{
  "publicId": "JEM-2023-PHY-001",
  "subjectKey": "physics",
  "chapterKey": "physics:gravitation",
  "type": "mcq_single",
  "text": "Question with $LaTeX$…",
  "options": ["$…$", "…"],
  "correctOptions": [0],
  "difficulty": "medium",
  "sourceYear": 2023,
  "sourceShift": "Shift 1",
  "solution": {
    "keyConcept": "…",
    "formulas": ["…"],
    "body": "**Step 1.** …",
    "commonMistakes": "…",
    "verification": "…"
  }
}
```

Types: `mcq_single`, `mcq_multi`, `numerical` (use `numericalAnswer` + optional
`numericalTolerance`). LaTeX via `$…$`; chemistry via `\ce{…}` (mhchem).

## Testing

```bash
bun run lint                          # must pass
bunx tsx scripts/test_marking.ts      # marking engine unit tests
python3 scripts/e2e_api_test.py       # practice/auth API E2E (dev server must be running)
python3 scripts/e2e_exam_test.py      # CBT engine E2E
python3 scripts/e2e_admin_test.py     # admin + import pipeline E2E
```

All suites must be green before merge. Verify UI changes in a browser.

## Database

- Dev runtime: SQLite via Prisma (`prisma/schema.prisma`).
- Production: Supabase PostgreSQL (`supabase/migrations/`), applied with
  `python3 scripts/apply_migration.py <file.sql>`.
- Schema changes go in BOTH places (Prisma for dev, SQL migration for prod).

## Reports & issues

Use GitHub issues. For question-content errors, prefer the in-app report button — it feeds the
admin review queue.
