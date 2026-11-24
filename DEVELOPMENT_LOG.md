# JEE NEXUS — Development Log

Honest, dated record of what was actually implemented, tested and deployed.
Legend: ✅ done · 🔄 in progress · ⏳ not started · 🚫 blocked

---

## 2026-11-23 — M13 · Question bank batch 3 — authored & verified (import pending DB access)

### Implemented
- **Coverage analysis tool** (`scripts/coverage_analysis.py`): chapter and year
  coverage across all batches against the 65-chapter taxonomy — now drives batch
  planning instead of ad-hoc greps.
- **Batch 3** (`data/questions/batch3_*.json`, `scripts/gen_batch3.py`): 12 new
  questions (4 physics / 4 chemistry / 4 mathematics) on 12 chapters untouched by
  batches 1-2 (physics: laws-of-motion, work-energy-power, waves,
  magnetic-effects-of-current; chemistry: some-basic-concepts, periodic-table,
  states-of-matter, aldehydes-ketones; mathematics: sets-relations-functions,
  mathematical-reasoning, probability, vectors). Year labels 2019 / 2020 / 2026 —
  **the PYQ year grid is now complete 2019–2026**. Types: 6 numerical, 4 mcq_single,
  2 mcq_multi. Same honesty policy as batches 1-2: standard formulations, labelled
  isAiGenerated, imported → needs_review (never auto-verified).
- **Independent verification** (`scripts/verify_seed_batch3.py`): **181/181 checks** —
  numeric recomputation, brute-force enumeration (injective maps, 52-card deck,
  truth tables), reference atomic-radii data, the (v×B)·v = 0 work identity, plus
  structural validation: fresh chapters (not in batch 1/2), publicId uniqueness,
  content-hash non-collision, type cardinality, solution completeness.
- **`scripts/import_batch3.py`**: the one-command import through the real admin
  pipeline (login → POST /api/admin/import → PATCH needs_review), credentials
  overridable via ADMIN_EMAIL / ADMIN_PASSWORD.

### Tests executed
- `scripts/verify_seed_batch3.py`: **181/181**.

### Deployment status
- Repo: batch3 JSONs + tooling committed. **Live DB import NOT run** — blocked on
  the lost jee_app credentials (same blocker as M12). Once the DATABASE_URL env is
  restored and the dev server runs against live Supabase:
  `python3 scripts/import_batch3.py` (expects the whitelisted admin account;
  override via ADMIN_EMAIL/ADMIN_PASSWORD if the DB was re-seeded).

### Remaining (honest)
- Import batch3 into the live DB (40 questions authored offline, 28 live).
- Same blockers as M12: jee_app password (DATABASE_URL secret for the Workers
  deploy + local dev), GH_PAT (2 local commits awaiting push).

## 2026-11-23 — M12 · Full app deployed to Cloudflare Workers (live)

### Implemented
- **Sandbox recovery**: this session started from an M7-era filesystem snapshot —
  restored the repo from origin/main (38 commits: all of M10 + M11 intact; local-only
  commit preserved on branch `backup-local-0e9b1ac` after `git cherry` showed its
  content superseded upstream). Lost with the snapshot: `.secrets/` (jee_app DB
  password, GH_PAT, Supabase management PAT) and the Postgres-era `.env`.
- **Production deploy LIVE** — https://jee-nexus-app.jee-nexus.workers.dev :
  - New user-provided account-scoped CF token (replaces the Pages-only CF_PAT):
    claimed `jee-nexus.workers.dev` (the account had never created a subdomain),
    uploaded the OpenNext worker `jee-nexus-app` with ASSETS + ADMIN_EMAILS bindings.
  - **db.ts dual-source DB path on Workers**: HYPERDRIVE binding if bound, else the
    DATABASE_URL secret over direct TCP (pg-worker adapter / cloudflare:sockets,
    Supabase session pooler). An unconfigured DB no longer crashes the isolate — the
    worker boots, UI/static routes serve, DB routes fail per-request until the secret
    or binding is added. Verified live: `/` 200 with the app shell, CSS/logo assets
    200, `/api/taxonomy` clean JSON 500.
  - **Deploy hardening (all found live)**: `bunx cloudflare` is not a binary — the
    OpenNext CLI is `opennextjs-cloudflare`; `source` without `set -a` doesn't export
    the token (curl worked because the shell expanded `$VAR` in-arg; wrangler, a child
    process, saw nothing); with this token scope wrangler's post-deploy status read
    (`GET /workers/workers/{name}`) returns 10007 even though the upload succeeded —
    the deploy script now judges success by the "Uploaded" marker and force-enables
    the workers.dev route via `POST .../scripts/{name}/subdomain` (the route ships
    disabled; the URL 404s with error 1042 until enabled). `workers_dev: true` added
    to wrangler.jsonc; `.open-next/` gitignored.
  - Landing page: nav + hero CTA link to the live app, test counter 70→82, roadmap
    updated; redeployed to Pages. README: hosting row + production-deployment section.

### Tests executed
- `tsc --noEmit` clean for src/ + scripts (pre-existing errors remain only in the
  `examples/` and `skills/` scaffold dirs, out of app scope); eslint 0 errors
  (7 warnings, all unused-disable directives in the generated worker client).
- OpenNext build green (all 20 API routes dynamic — no build-time DB access).
- Live smoke: `/` 200, static assets 200, `/api/taxonomy` JSON 500 as expected
  (no DB secret yet). GitHub CI could not run on these changes — no push (below).

### Deployment status
- App live at https://jee-nexus-app.jee-nexus.workers.dev (UI + static assets).
- Landing (Pages) links to it.

### Remaining (honest)
- **DB wiring needs the jee_app password** — it existed only in `.secrets/supabase_db.env`
  (gitignored by design) and was lost with the sandbox snapshot. One step once provided:
  `bunx wrangler secret put DATABASE_URL --name jee-nexus-app` with the session-pooler
  URL (or reset via the Supabase dashboard, then `ALTER ROLE jee_app ... PASSWORD`).
  DB-backed routes return 500 until then. Hyperdrive remains unavailable: the token
  lacks Hyperdrive:Edit (create returns 10001) — the direct-TCP fallback is deployed
  instead, so Hyperdrive is now purely an optimization, not a blocker.
- **GH_PAT lost** — commits from this session are local-only until
  `.secrets/tokens.env` is recreated (push.sh now says so instead of failing silently).
- Question bank depth: 28 of the 2019–2026 target.

## 2026-11-23 — M11 · Question bank batch 2 + Playwright browser suite + Cloudflare deploy scaffolding

### Implemented
- **Question bank batch 2** (`data/questions/batch2_*.json`, `scripts/gen_batch2.py`):
  12 new PYQ-labelled questions (4 physics / 4 chemistry / 4 mathematics) across chapters
  batch 1 didn't touch, years 2024–2025 (extends the PYQ year grid), all three types
  (6 numerical, 5 mcq_single, 1 mcq_multi), full solutions (concept / formulas / steps /
  mistakes / verification). **Every answer independently verified** by
  `scripts/verify_seed_batch2.py` — **154/154 checks**: numeric recomputation, exhaustive
  binomial expansion, derivative-sign scans, oxidation-state algebra, plus structural
  validation (taxonomy keys, option ranges, type cardinality, publicId uniqueness,
  contentHash non-collision with batch 1, honest isAiGenerated labelling).
- **Imported through the REAL pipeline**: `scripts/import_batch2.py` signs in as the
  whitelisted admin and POSTs to `/api/admin/import` (12/12 inserted, 0 rejected),
  then PATCHes each question imported → needs_review (honest editorial state — never
  auto-verified). Live DB now serves 28 questions; PYQ year grid shows 2024 (7) and
  2025 (6) with real counts.
- **E2E/browser test data cleaned from production**: targeted SQL cleanup of TEST-IMP-*,
  IMP-*, E2E-* users/exams/import-jobs, then pw-* accounts after the browser runs —
  live DB back to exactly 1 admin user + 28 seed questions.
- **Playwright browser suite** (`tests/browser/*.spec.ts`, `playwright.config.ts`):
  12 tests — auth (signup → sign out → login), practice (answer → graded → solution →
  session summary), PYQ (year grid, year → subject → detail, chapter filter),
  **CBT full lifecycle** (custom test → palette 5-state legend → timer → answer →
  mark-for-review → NTA submit dialog cancel/confirm → result screen) and **CBT resume**
  (autosave lands, reload, re-entry restores the saved answer), plus mobile-viewport
  smoke (burger nav, no horizontal overflow). CI gained a `browser-e2e` job (Postgres 17
  service + migrations + seed + dev server + Chromium).
- **Cloudflare Workers deployment scaffolding** (deploy blocked on token scope — see below):
  dual-runtime Prisma (schema keeps `prisma-client-js` for node AND a `prisma-client`
  cloudflare-runtime generator at `src/generated/worker` — pure-JS query compiler, no
  native engine); `src/lib/db.ts` now constructs the Hyperdrive-backed worker client
  via `getCloudflareContext({ async: false })` on Workers and falls back to the node
  client everywhere else (single sync code path — no route changes);
  `wrangler.jsonc` + `open-next.config.ts` + `scripts/deploy_app_cloudflare.sh`
  (with a REFUSED guard until the Hyperdrive binding is wired).

### Bugs found & fixed during verification
- Browser-test races (all caught by running the suite against the real UI):
  - the practice filter panel's "Revision mode" checkbox matches a naive option-label
    locator before the session API resolves — wait for the question-card header first;
  - Radix controls wrapped in `<label>` double-toggle when clicked directly — click the
    label, not the control;
  - the header user button ("R Resume …") matches a loose `/resume/` pattern — scope
    re-entry locators to the exam card;
  - the fresh-DB empty-state hint contains the words "Create a custom test" — assert the
    dialog by heading role;
  - mid-exam reload can abort the in-flight autosave POST — arm the response listener
    before the interaction and await it.
- CI-only failure reproduced from logs (strict-mode violation invisible locally because
  the live DB had a default exam, hiding the empty-state hint).

### Tests executed
- `scripts/verify_seed_batch2.py`: **154/154**.
- API E2E re-run after the dual-runtime db.ts refactor: **23/23** (node fallback path
  unchanged), tsc + eslint clean, `next build` green with the worker client bundled.
- Playwright suite: **12/12** locally against the live Postgres-backed dev server.
- **CI on GitHub fully green** (all five jobs): lint, unit, pg-parity (29 checks),
  api-e2e (70 tests), browser-e2e (12 Playwright tests) — including two CI-only
  flake classes found and fixed along the way (fresh-DB empty-state hint text;
  random-question-dependent "your answer" chip).

### Deployment status
- Live DB: 28 verified-answer seed questions, PYQ years 2021–2025 populated.
- GitHub: incremental pushes throughout; CI: lint + unit + pg-parity + api-e2e green,
  browser-e2e fix pushed.
- Landing roadmap updated.

### Remaining (honest)
- **Cloudflare app deploy is blocked on the API token scope**: `CF_PAT` has Pages:Edit
  only; Hyperdrive config creation returns 10001 (Workers/Hyperdrive write denied —
  reads work). The one-command path once a token with Hyperdrive:Edit + Workers:Edit
  exists: create the Hyperdrive config (command in the deploy script), paste its id into
  `wrangler.jsonc`, run `bash scripts/deploy_app_cloudflare.sh`. The db.ts worker path
  and wrangler config are already in place but NOT yet exercised against a real
  deployment — treat them as untested until then.
- Question bank depth: 28 of the 2019–2026 target.

## 2026-11-23 — M10 · Supabase production cutover — app runs on live PostgreSQL

### Implemented
- **DB access recovery**: the stashed `postgres` password was invalid (auth failed on both
  pooler modes; the management password-reset endpoint does not exist for this PAT —
  confirms the M9 finding). `postgres` cannot self-alter (privileged role). Path taken:
  **dedicated `jee_app` login role** (`supabase/migrations/0003_app_role.sql`) — created via
  the SQL endpoint (postgres has CREATEROLE), password set by `scripts/create_app_role.sh`
  (random 48-hex, stored only in `.secrets/supabase_db.env`, gitignored). Grants: full DML
  on public schema + permissive RLS policies scoped to `jee_app` + default privileges for
  future tables. The app never connects as `postgres` — same trust model as service_role.
- **Prisma schema rewritten for PostgreSQL** with exact parity to the live DDL:
  `@@map`/`@map` to snake_case tables/columns (18 tables), native enums
  (`question_type`, `difficulty`, `verification_status`, `app_role` — enums needed `@@map`
  too, caught by runtime test), `Json` for all jsonb columns, `@db.DoublePrecision` for
  marks/numerical answers (migration 0002 converts the 5 `numeric` columns),
  `@db.Timestamptz(6)` everywhere.
- **App code adapted to native types** (29 JSON.parse/stringify sites removed — jsonb now
  arrives parsed; Float coercions for numerical answers; enum casts). Frontend contract
  unchanged: the API layer already shipped parsed arrays.
- **Diamond-FK cascade fix** (migration 0004): `exam_attempt_answers → exam_questions` edge
  made CASCADE — exam deletion previously hit order-dependent RESTRICT failures.
- **`db:push` production guard** (`scripts/db_push.sh`): refuses any supabase/pooler URL;
  live schema is managed exclusively via `supabase/migrations/*.sql` + SQL endpoint.
- **CI on PostgreSQL 17** service containers: applies the real migration files via psql,
  plus a new `pg-parity` job (Prisma client vs live DDL: enums, jsonb roundtrips, Float,
  timestamptz, upserts, P2002/P2003 mapping, cascade/restrict semantics — 29 checks),
  then the existing three E2E suites against the migrated+seeded DB.
- Seeded the live database: 3 subjects, 65 chapters, 16 questions (+36 options, 16 solutions).

### Bugs found & fixed during verification
- Prisma enum values emitted with Prisma-side names (`public."QuestionType"`) — enums need
  `@@map("question_type")`; caught by the parity test.
- Two unmapped columns (`isCorrect` → `is_correct` on attempts/exam answers) — caught by
  parity test (P2022).
- `prisma db execute` hangs through the Supabase **transaction** pooler on multi-statement
  scripts — session pooler (5432) executes fine but jee_app must not own tables anyway;
  CI therefore applies migrations with psql, production via the SQL endpoint.
- Stale exported `DATABASE_URL` in the dev shell shadowed `.env` (P1012) — unset before
  every prisma/dev-server invocation.

### Tests executed
- `scripts/test_pg_runtime.ts`: **29/29** against the live Supabase PostgreSQL as jee_app.
- Full regression against the live DB through the dev server: API E2E **23/23**,
  CBT E2E **23/23**, Admin E2E **24/24** — **70/70**.
- `tsc --noEmit` clean for src/ + scripts (also fixed 5 pre-existing type errors);
  `eslint` clean.
- CI pushed with the new workflow (Postgres 17 services, psql migrations, pg-parity job).

### Deployment status
- App: dev runtime on live Supabase PostgreSQL (kwavmbowgvgphaccrqlc, ap-south-1) via
  transaction pooler as jee_app. SQLite runtime retired.
- GitHub: incremental pushes throughout.

### Remaining (honest)
- CI run on GitHub needs confirmation (pushed with the new workflow; locally verified
  migrations are idempotent + suites green against the same DDL).
- Cloudflare production deployment of the app itself (only the landing is live).
- Playwright scripted browser suite still pending.
- Question bank depth: 16 seeded PYQs vs the 2019–2026 target.

## 2026-11-23 — M9 · Supabase production database + CI + docs

### Implemented
- **Production PostgreSQL migration** (`supabase/migrations/0001_init.sql`): 18 tables mirroring
  the Prisma schema with native PG types (enums for question_type/difficulty/verification_status/
  app_role, numeric answers, jsonb), all hot-path indexes, CHECK constraints.
- **Row Level Security** — enabled on all 18 tables:
  - anon: read-only on public reference data (subjects, chapters, non-rejected questions,
    published exams, exam patterns)
  - answers/solutions/user tables: NO anon policies (service-role only)
  - per-user authorization enforced server-side in the API layer
- **Applied live** via Supabase management API SQL endpoint (`scripts/apply_migration.py`,
  `scripts/supabase_sql.py`) to project `kwavmbowgvgphaccrqlc` (PostgreSQL 17.6, ap-south-1).
- **GitHub Actions CI** (`.github/workflows/ci.yml`): lint + marking unit tests + all three E2E
  suites against a seeded SQLite dev DB — **passing on GitHub**.
- `CONTRIBUTING.md` (ground rules incl. push-often policy), `.env.example` (gitignore exception
  fixed — `.env*` was swallowing it).
- DB password reset attempted via API (endpoint not permitted for this PAT — credentials remain
  dashboard-managed; anon/service keys stashed in `.secrets/` for future wiring).

### Tests executed
- Migration: 8/8 chunks applied, then live verification — 18 tables present, RLS enabled on 18,
  5 policies created.
- **RLS boundary proven with data**: anon key reads `subjects` → rows; anon reads `app_users` →
  empty; service_role reads `app_users` → rows.
- CI run on GitHub: success (lint, unit, api-e2e, exam-e2e, admin-e2e).

### Deployment status
- Supabase: schema + RLS LIVE on PostgreSQL 17.6.
- GitHub: CI green.
- Landing: roadmap updated.

### Remaining (honest)
- App still runs on the sandbox SQLite runtime — switching DATABASE_URL to the Supabase pooler
  requires the DB password (dashboard) and Prisma postgres provider swap; schema parity is ready.
- Question bank depth: 16 seeded PYQs vs the 2019–2026 target — import pipeline is ready for
  bulk verified batches.
- Playwright browser suite: browser verification done manually via agent-browser; scripted
  Playwright specs pending.

---

## 2026-11-23 — M8 · Admin dashboard + import pipeline

### Implemented
- **Import pipeline** (`src/lib/import.ts`): row-level validation (subject/chapter keys, option
  counts, correct-option ranges, mcq_single/mcq_multi cardinality, numerical answer+tolerance,
  solution minimums, image url/altText), contentHash duplicate detection (cross-batch + in-batch),
  publicId collision handling, ImportJob tracking with row-level errors.
  Imported questions enter as `imported` — **never auto-verified**.
- **Admin APIs** (all `requireAdmin`, server-side role checks):
  - `POST /api/admin/import` — bulk import (max 500/batch, rate-limited)
  - `GET/PATCH /api/admin/questions` — filtered list + edit (text, difficulty, options,
    correctOptions, numericalAnswer, solution upsert with version increment) + verify/reject
    transitions (verify stamps solution.verifiedAt)
  - `GET/PATCH /api/admin/reports` — open report queue; resolve flags verified questions back
    to needs_review
  - `GET /api/admin/stats` — pipeline counts, subject/year distribution, totals, import job history
- **Admin dashboard UI** (`AdminView.tsx`): Overview (pipeline badges, subject/year splits, import
  jobs), Import tab (file upload / paste JSON / load example / per-row error report), Questions tab
  (search + status filter + pagination + expandable rows with options + Verify/Needs-review/Reject),
  Reports tab (resolve/dismiss). Admin nav item renders only for admin role.
- Admin bootstrap: first user OR `ADMIN_EMAILS` whitelist (env).

### Bugs found & fixed during verification
- `api()` client helper hardcoded POST for bodies — admin PATCH actions returned 405; helper now
  accepts an explicit method. Caught by browser network trace.
- E2E harness bugs (cookie leak in anonymous check, wrong import-job row, non-idempotent signup,
  always-zero fail counter) — fixed in the test scripts themselves.

### Tests executed
- `scripts/e2e_admin_test.py`: **24/24** — role bootstrap, student 403 / anonymous 401 access
  control, mixed-batch import (2 valid / 3 invalid with reasons), duplicate re-import detection,
  verification workflow, edit persistence, report lifecycle, stats + job tracking.
- Full regression: API 23/23, CBT 23/23 — **70/70 total**.
- Browser: admin dashboard renders (pipeline overview), example import inserts (1/1) and appears
  in question list, Verify click persists to DB (network-traced PATCH 200).

### Deployment status
- GitHub: incremental pushes throughout.
- Landing: roadmap updated → https://jee-nexus-5wd.pages.dev

### Next
- M9: Supabase PostgreSQL migrations + RLS, CI workflow, CONTRIBUTING
- Question bank expansion (verified batches)

---

## 2026-11-23 — M6 · CBT examination engine

### Incident note
Sandbox recycle lost the first (uncommitted) CBT implementation. **Process changed: every file is
committed and pushed the moment it is written** (`scripts/push.sh` helper). No batch commits since.

### Implemented
- **Marking engine as data** (`src/lib/exam.ts`): JEE Main 2025 rules — single-correct +4/−1,
  multiple-correct partial (+4 all / +3 / +2 / +1, 0 on any wrong option), numerical +4/−1 with
  tolerance. Driven by `ExamPattern.config`, never hardcoded at call sites.
- **Exam generation** (`src/lib/examService.ts`): deterministic seeded selection from the live bank,
  honest shortfall warnings ("only N questions available — exam shortened honestly"), default
  pattern bootstrap.
- **5 exam APIs**: list/generate · start (resume-in-progress, custom duration honored,
  no answer leakage) · answer (autosave with server-authoritative deadline + 30s grace,
  visited/mark-for-review/time tracking) · submit (server-side grading, expired-late handling,
  double-submit rejection) · result (score, per-section stats, question-wise review with solutions,
  attempt history).
- **NTA-style runner UI** (`ExamRunner.tsx`): section tabs, question palette with 5-state legend
  (answered / not answered / marked / answered+marked / not visited), timer with low-time pulse,
  Save & Next / Mark for Review & Next / Clear Response / Previous, NTA submit-confirmation dialog,
  auto-submit at zero (server authoritative on grading), mobile palette via details disclosure.
- **Result screen** (`ResultScreen.tsx`): score hero, per-section breakdown, question-wise review
  with correct/your-answer highlighting, expandable detailed solutions.
- **Mock hub** (`MockView.tsx`): exam list with re-attempt, custom test builder
  (subject / count / duration), attempt history with score navigation.
- Schema: `ExamAttemptAnswer.markedForReview` persisted (survives resume).

### Bugs found & fixed during verification
- Array-vs-number comparison in partial marking (`right === correct.length` always false) —
  caught by unit tests, would have mis-graded multiple-correct questions.
- Custom test duration ignored at start (used pattern's 180min instead of configured) —
  caught by browser test timer read (179:57); fixed + verified 5.0-minute deadline.
- Stale Prisma client after schema push required dev-server restart (documented).

### Tests executed
- `scripts/test_marking.ts`: **25/25** marking unit tests (partial marking edge cases, tolerance,
  duplicates, empty/garbage inputs, negative answers, no-partial mode).
- `scripts/e2e_exam_test.py`: **23/23** CBT API E2E (generation → start → answer × 3 types →
  resume with state restoration → submit/grade → double-submit rejection → result review →
  history → anonymous 401).
- `scripts/e2e_api_test.py`: **23/23** regression pass.
- Browser (agent-browser): signup → create custom physics test → runner renders (palette/timer/
  KaTeX options) → answer + mark-for-review → NTA submit dialog summary → submit → history shows
  −1/24 → result screen with per-section stats → solutions expand in review. 0 console errors.
- Duration override: fresh 5-minute custom exam verified 5.0-minute deadline.

### Deployment status
- GitHub: every component pushed immediately (7 incremental commits).
- Landing: https://jee-nexus-5wd.pages.dev — roadmap updated.

### Next
- M8: admin dashboard + import pipeline (CSV/JSON validation, dedup, verification workflow)
- M9: Supabase Postgres migrations + RLS, CI, Playwright suite

---

## 2026-11-23 — M4/M5/M7 · Interactive application (practice, PYQ library, analytics)

### Implemented
- **Full SPA application** (hash-routed, single visible `/` route per platform constraint):
  - `HomeView` — hero with live question counts, subject cards, stats (signed-in), recent activity, year shortcuts
  - `PracticeView` — filter panel (subject / chapters / years / difficulty / type / count / revision mode),
    session flow with progress bar, per-question timing, session summary with accuracy
  - `PyqView` — year grid (2019–2026, real counts only) → subject+chapter breakdown with per-chapter
    attempted/accuracy → paginated question list → full question detail with solution
  - `PerformanceView` — headline stats, 14-day activity line chart, subject accuracy bar chart (recharts),
    weak/strong chapter lists, recent attempt history, honest empty states
  - `BookmarksView` — bookmark list + review with solutions
  - `ProfileView` — login / signup / password recovery / reset / logout
- **QuestionCard** — KaTeX + mhchem rendering, 3 question types (radio / checkbox / numerical input),
    correct/incorrect result highlighting, zoomable diagrams, source metadata badges, unverified badge,
    bookmark toggle, report dialog (6 reasons)
- **SolutionView** — concept box, formula list, step-by-step body, common mistakes, collapsible
    alternative method, final verification, source references, AI-generated disclosure badge
- Premium dark identity throughout, light mode toggle, mobile burger nav, skeleton loaders, toasts.
- Fixed: SSR hydration mismatch in hash router (post-mount hash adoption), useApi setState-in-effect,
  PYQ response shape (`years` wrapper), attempt recording only on real submissions.

### Files created / modified
- `src/app/page.tsx` (app shell), `src/app/layout.tsx` (JEE NEXUS metadata)
- `src/lib/client.ts` (hash router + API hooks)
- `src/components/QuestionCard.tsx`, `src/components/MathText.tsx`
- `src/components/views/{Home,Practice,Pyq,Performance,Bookmarks,Profile}View.tsx`

### Tests executed
- API E2E suite: **23/23 passing** (auth, random selection, repeat avoidance, grading, bookmarks,
  reports, stats, PYQ, security guards) — `scripts/e2e_api_test.py`
- Browser verification (agent-browser, headless Chromium):
  - home renders with live taxonomy counts
  - practice flow: surprise question → numerical answer "3.47" → graded Correct → full solution rendered
  - PYQ: 2023 → physics → Gravitation question → KaTeX + solution in detail view
  - signup (browser-test@jee-nexus.dev) → answer MCQ → bookmark → bookmarks page lists it
  - performance dashboard populates with real attempt data
  - mobile viewport 390×844: desktop nav hidden, burger menu present, footer at document end
  - zero page errors after fixes

### Deployment status
- App: live preview (sandbox) — verified working
- Landing: https://jee-nexus-5wd.pages.dev (roadmap updated per milestone)
- GitHub: milestone commits pushed to `main`

### Remaining issues
- Supabase project restored (ACTIVE_HEALTHY) — production Postgres sync + RLS still to apply (M9)
- CBT examination mode not built yet (M6) — placeholder view in nav

### Next
- M6 CBT engine (exam patterns as data, NTA-style runner, server-authoritative timer, results + review)
- M8 admin dashboard + import pipeline
- M9 Supabase Postgres migrations + RLS

---

## 2026-11-23 — M2+M3 · Auth, question engine, APIs, seeded PYQ bank

### Implemented
- **Auth**: scrypt password hashing, httpOnly session cookies (30d), signup/login/logout/me,
  password recovery + reset (sandbox inline token; production = Supabase email), rate limiting,
  first-user/admin-email bootstrap for admin role.
- **12 API routes**: auth×6, taxonomy (subjects+chapters+counts), random selection, question detail,
  submit+grade, bookmarks (list/toggle), reports, stats, PYQ (year overview / year breakdown / list).
- **Server-side grading** — answers never ship to the client before submission:
  - mcq_single: exact one match; mcq_multi: exact set match; numerical: tolerance-based
- **Repeat avoidance**: excludes recently served + last-14-day attempted (unless revision mode)
- **Seed data**: 16 PYQs across P/C/M with full solutions, every answer numerically verified
  (`scripts/verify_seed_batch1.py` — 12/12 checks), 65-chapter taxonomy, contentHash dedup.
- Seed verification: MAT-003 (divisibility count 336) brute-force verified with case breakdown 272+64;
  PHY-006 river crossing corrected from 12.5 to 12 min during authoring QA.

### Tests executed
- `bun run lint` clean
- API E2E: 23/23 passing

### Deployment status
- GitHub pushed; landing updated

---

## 2026-11-23 — M1 · Foundation

### Implemented
- Environment + integration inspection (GitHub `mayankgit9`, Cloudflare account, Supabase API).
- Cloudflare Pages project `jee-nexus` created → **https://jee-nexus-5wd.pages.dev**; landing deployed + verified.
- GitHub repo `mayankgit9/jee-nexus` created; secret-free history enforced (push protection hit → orphan-squash;
  `.secrets/`, `.env`, dev DB gitignored).
- Prisma schema: 20 models (users/sessions/resets, taxonomy, questions+options+images, solutions,
  exam patterns/exams/exam-questions/exam-attempts/answers, attempts, bookmarks, reports, import jobs).
- Design system: original premium dark identity (mint primary, gold/violet accents), light theme,
  custom scrollbars, subject color tokens.
- KaTeX + mhchem installed; MathText renderer ($…$, $$…$$, \ce{}).

### Deployment status
- LIVE landing; GitHub initial push

---

## Project checklist

| Area | Status |
| --- | --- |
| Foundation (repo, schema, design, deploy pipeline) | ✅ |
| Auth (signup/login/logout/recovery, guards, rate limits) | ✅ |
| Question engine (rendering, LaTeX+mhchem, 3 types, images) | ✅ |
| Seeded verified PYQ bank (16 questions) | ✅ |
| Random practice (filters, repeat avoidance, solutions) | ✅ |
| Year-wise PYQ library (browse, filters, chapter analysis) | ✅ |
| Bookmarks & attempt history | ✅ |
| Analytics dashboard (charts, weak/strong chapters) | ✅ |
| CBT examination mode | ✅ |
| Admin dashboard + import pipeline | ⏳ |
| Supabase Postgres + RLS production sync | 🔄 (project ACTIVE, migrations pending) |
| Cloudflare production app deployment | ⏳ (landing live; app runs in sandbox preview) |
| Automated tests | 🔄 (23 API E2E + browser verification; Playwright suite pending) |
| Question bank depth (16 seeded; 2019–2026 target) | 🔄 |
