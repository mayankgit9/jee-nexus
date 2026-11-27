-- JEE NEXUS — 0015: weekly winners snapshots
--
-- weekly_winners: pinned top-3 of each CLOSED leaderboard week. The live
-- board is a rolling trailing-7-days window (weekOffset archives walk back),
-- so a week's champions used to be reconstructable only while their window
-- stayed in the 12-week archive. This table is the permanent record: a
-- GitHub Actions cron (weekly-winners.yml) runs shortly after Monday
-- 00:00 UTC and POSTs the closed window [Mon-7d, Mon) to
-- POST /api/leaderboard/snapshot (bearer-token gated), which ranks users
-- with the SAME merged logic as GET /api/leaderboard (practice attempts +
-- graded CBT answers, ties: correct desc, time asc) and inserts 0-3 rows.
--
-- Idempotency: unique (window_start, window_end, rank) + Prisma
-- createMany(skipDuplicates) — a workflow re-run or manual dispatch can
-- never duplicate or overwrite a pinned podium.
--
-- user_name is a snapshot copy (display name at pin time); user_id is SET
-- NULL on user deletion so the hall of fame survives account cleanup with
-- the historical name intact.

create table if not exists weekly_winners (
  id           text primary key,
  window_start timestamptz(6) not null,
  window_end   timestamptz(6) not null,
  rank         integer not null,
  user_id      text references app_users(id) on delete set null,
  user_name    text not null,
  attempts     integer not null,
  correct      integer not null,
  accuracy     integer not null,
  time_seconds integer not null default 0,
  created_at   timestamptz(6) not null default now(),
  unique (window_start, window_end, rank)
);

create index if not exists weekly_winners_window_idx
  on weekly_winners (window_end desc, rank asc);
