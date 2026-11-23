# JEE NEXUS — Development Log

Honest, dated record of what was actually implemented, tested and deployed.
Legend: ✅ done · 🔄 in progress · ⏳ not started · 🚫 blocked

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
