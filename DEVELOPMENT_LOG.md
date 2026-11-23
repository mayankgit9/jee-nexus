# JEE NEXUS — Development Log

Honest, dated record of what was actually implemented, tested and deployed.
Legend: ✅ done · 🔄 in progress · ⏳ not started · 🚫 blocked

---

## 2026-11-23 — M1 · Foundation

### Implemented
- Environment inspection: sandbox (Node 24, bun, Python 3.12), GitHub, Supabase, Cloudflare all reachable.
- **Integrations**
  - GitHub connected as `mayankgit9`. Created repository `mayankgit9/jee-nexus`.
  - Cloudflare account connected (account-scoped token; R2 not enabled on account — not required, diagrams are repo-hosted SVGs).
  - Supabase management API connected; project restore from INACTIVE requested (`kwavmbowgvgphaccrqlc`), pending activation.
- **Database**
  - Full normalized Prisma schema (20 models): users/sessions/password-resets, subject/chapter taxonomy, questions + options + images, solutions, exam patterns/exams/exam-questions/exam-attempts/answers, practice attempts, bookmarks, reports, import jobs.
  - Indexes on hot paths (subject+chapter, year+subject, verification status, type).
  - `contentHash` unique constraint for duplicate detection.
- **Design system**
  - Original premium dark identity (deep charcoal-blue base, mint primary, gold/violet subject accents), optional light theme, custom scrollbars, grid + glow flourishes, subject color tokens.
- **Frontend foundation**
  - Domain types library (`src/lib/types.ts`) covering question types, exam pattern config, subject/difficulty metadata.
  - KaTeX installed for mathematical notation rendering.
- **Deployment**
  - Cloudflare Pages project `jee-nexus` created → https://jee-nexus-5wd.pages.dev
  - Static landing page (brand, features, roadmap) deployed and verified HTTP 200.
  - Reproducible deploy: `scripts/deploy_landing.sh`.

### Files created / modified
- `prisma/schema.prisma` (full rewrite)
- `src/app/globals.css` (full rewrite — JEE NEXUS identity)
- `src/lib/types.ts`
- `landing/index.html`, `landing/favicon.svg`
- `README.md`, `DEVELOPMENT_LOG.md`, `.env.example`, `.gitignore` (secrets hardening)
- `scripts/inspect_accounts.sh`, `scripts/supabase_restore.sh`

### Tests executed
- `prisma db push` — schema applied cleanly, client generated.
- Token verification API calls for all three providers.
- Production URL smoke test: `HTTP 200`, correct title served.

### Deployment status
- LIVE: https://jee-nexus-5wd.pages.dev (landing).
- GitHub: initial commit pushed.

### Remaining issues
- Supabase restore still pending (background) — production Postgres sync is M9.
- Cloudflare R2 not enabled on account (optional; not blocking).

### Next
- M2/M3: auth + question engine + seeded verified PYQ bank.

---

## Project checklist

| Area | Status |
| --- | --- |
| Foundation (repo, schema, design, deploy pipeline) | ✅ |
| Auth (signup/login/logout/recovery, guards) | 🔄 |
| Question engine (rendering, LaTeX, diagrams, 3 types) | 🔄 |
| Seeded verified PYQ bank | ⏳ |
| Random practice | ⏳ |
| Year-wise PYQ library | ⏳ |
| Solution engine UI | ⏳ |
| CBT examination mode | ⏳ |
| Analytics dashboard | ⏳ |
| Bookmarks & history | ⏳ |
| Admin dashboard + import pipeline | ⏳ |
| Supabase Postgres + RLS production sync | ⏳ |
| Cloudflare production app deployment | ⏳ |
| Automated tests (vitest + Playwright) | ⏳ |
