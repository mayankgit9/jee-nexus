# JEE NEXUS — UI/UX Remake Brief (2026-11-28)

Shared design spec for the remake. Follow it EXACTLY so parallel work feels like one product.

## Mission
Make JEE NEXUS the best-looking, most addictive JEE practice app in India.
Tone: premium esports-meets-study arena. Dark, sharp, energetic — NEVER childish.

## Identity (KEEP — do not change)
- Dark-first (`.dark` class on `<html>`; theme toggles exist in the shell).
- Palette lives in `src/app/globals.css` CSS vars (shadcn tokens). Primary = mint
  `oklch(0.82 0.16 166)`. Subject colors: `--subj-physics` (sky-cyan), 
  `--subj-chemistry` (violet-magenta), `--subj-mathematics` (amber-orange).
  Use them via Tailwind classes `text-subj-physics`, `bg-subj-chemistry/15`, etc.
- Fonts: Geist Sans (`font-sans`) + Geist Mono for numbers/latency-style stats.
- NO blue/indigo as a dominant color. NO purple gradients. NO emoji in UI text
  (Lucide icons only). NO plain solid color blocks where a subtle gradient/glow
  would do.

## Elevation system (NEW — use consistently)
```css
.surface       { background: linear-gradient(180deg, oklch(0.19 0.014 240 / .9), oklch(0.16 0.014 240 / .9)); border: 1px solid var(--border); }
.surface-hover { transition: transform .2s cubic-bezier(.2,.8,.2,1), border-color .2s, box-shadow .2s; }
.surface-hover:hover { transform: translateY(-2px); border-color: color-mix(in oklab, var(--primary) 35%, var(--border)); box-shadow: 0 8px 30px -12px oklch(0.82 0.16 166 / .25); }
```
- Cards: `rounded-xl surface` (NOT bg-card flat everywhere) — but KEEP `p-4/p-6` and `gap-4/gap-6` rhythm.
- Glow accents for primary CTAs: `shadow-[0_0_24px_-6px_var(--primary)]` on hover.
- Gradient text for big numbers: `bg-gradient-to-r from-primary to-chart-2 bg-clip-text text-transparent`.

## Motion (framer-motion is installed; use it)
- Page/view enter: `motion.div initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{duration:.25, ease:[0.2,0.8,0.2,1]}}` — stagger children by 0.03-0.05s (`staggerChildren`).
- Micro: buttons/tap targets scale on tap `whileTap={{scale:.97}}`, `whileHover={{y:-1}}`.
- Count-up numbers: use a tiny `useCountUp`-style hook or spring `animate()` from framer-motion for XP/accuracy/streak values.
- Respect `prefers-reduced-motion` (framer `useReducedMotion`).

## Gamification language
- Streak = flame icon (Lucide `Flame`) + number; "day streak".
- XP where shown: mono font, mint gradient; level chips = rounded pill with ring.
- Correct answer = canvas-confetti burst (import `canvas-confetti`, default export;
  `confetti({particleCount:90, spread:70, origin:{y:.6}, colors:['#5eead4','#fbbf24','#f472b6']})`).
  Only fire on transitions to correct (never on every render).
- Accuracy rings: SVG `strokeDasharray` ring, mint for ≥70, amber ≥50, red below.

## Text-overflow hardening (MANDATORY — this fixes real user-visible bugs)
- NEVER remove the existing `.math-text`, `.katex-*` overflow rules in globals.css — they fix
  "text overridden/overlapping" complaints. If you touch globals.css, keep them intact
  (they are marked with a comment mentioning overflow hardening).
- Any user-generated or data string area gets: `break-words`/`overflow-wrap:anywhere`,
  `min-w-0` on flex parents, `truncate` with `title` attr for single-line metas.
- Long list containers: `max-h-96 overflow-y-auto` + the custom scrollbar styles already in globals.css.
- Math content must NEVER set a fixed width wider than its card; block math stays
  horizontally scrollable (`overflow-x-auto`), never pushes layout.

## Accessibility & responsiveness (MANDATORY)
- Touch targets ≥44px; icon-only buttons need `aria-label` or `title`.
- Every view must work at 360px width. Bottom tab bar is the mobile nav — don't break it.
- Semantic HTML: main/section/nav; focus-visible rings (var(--ring)) on interactive elements.

## Architecture rules
- Files use `'use client'`; views are imported by `src/app/page.tsx` (hash-routed SPA shell).
- API calls go through helpers in `src/lib/client.ts` (`useApi`, `api`, `navigate`).
- shadcn/ui components in `src/components/ui/*` — use them (Button, Card, Input, Tabs,
  Dialog, Badge, Progress, etc.) instead of raw divs where they fit.
- DO NOT edit files outside your assigned list (parallel agents own other files).
- DO NOT run `bun run dev`, `bun run build`, or start servers. Do not run SQL or hit
  production APIs with writes. Lint with `bun run lint` is OK.
- TypeScript strict: no `any` unless the file already does.

## Current API surface you may need
- `GET /api/auth/me` → `{ user: SessionUser | null }`; SessionUser = `{ id, username, email: string|null, name, role }`.
- `POST /api/auth/signup` `{ username, password, email? }` → `{ user }` (username 3-20 chars
  `[a-z0-9_.-]`, password ≥8; email optional, recovery-only).
- `POST /api/auth/login` `{ username, password }` → `{ user }`.
- `POST /api/auth/recover` `{ mode: 'username', email }` → `{ ok, usernames }`; 
  `{ mode: 'password', username, email }` → `{ ok, resetToken? }` (inline token when
  username+email match — no SMTP on this deployment).
- `POST /api/auth/reset` `{ token, password }` → `{ ok }`.
- Chat: `GET/POST /api/chat/messages?conversationId=lobby` — lobby is PUBLIC: reading needs
  NO auth; guests POST `{ conversationId:'lobby', body, guestName }` (guestName 2-24 chars).
  Signed-in users POST `{ conversationId:'lobby', body }`. Message shape includes
  `isGuest: boolean`, `senderName`, `senderId (string|null)`, `replyTo`, `reactions`.
  `GET /api/chat/conversations` → sidebar (lobby auto-included). Poll with `after=` cursor.
