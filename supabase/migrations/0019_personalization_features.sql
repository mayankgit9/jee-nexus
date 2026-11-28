-- JEE NEXUS migration 0019 — personalization & study feature tables
-- Applies: solutions verification workflow, image audit fields, mistake
-- notebook, spaced repetition, saved test configs, formula cards, hints,
-- syllabus tracker, chat attachments, offline attempt sync key.
-- All tables follow the house pattern: RLS enabled + "app full access"
-- policy for jee_app + explicit grants; per-user ownership stays enforced
-- in the API layer via server-side session checks (see src/lib/auth.ts).

-- ---------------------------------------------------------------------------
-- Part A — solution verification workflow
-- ---------------------------------------------------------------------------
ALTER TABLE solutions
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'ai_generated',
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note TEXT;

CREATE TABLE IF NOT EXISTS solution_revisions (
  id          TEXT PRIMARY KEY,
  solution_id TEXT NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  version     INT  NOT NULL,
  snapshot    JSONB NOT NULL,
  edited_by   TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS solution_revisions_solution_idx ON solution_revisions(solution_id, created_at);

CREATE TABLE IF NOT EXISTS solution_gen_log (
  id                TEXT PRIMARY KEY,
  question_id       TEXT NOT NULL,
  status            TEXT NOT NULL,            -- ok | failed
  attempts          INT  NOT NULL DEFAULT 1,
  source            TEXT,                      -- web+ai | ai
  model             TEXT,
  prompt_tokens     INT,
  completion_tokens INT,
  cost_usd          DOUBLE PRECISION,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS solution_gen_log_created_idx ON solution_gen_log(created_at);
CREATE INDEX IF NOT EXISTS solution_gen_log_status_idx ON solution_gen_log(status, created_at);

-- ---------------------------------------------------------------------------
-- Part B — question image audit
-- ---------------------------------------------------------------------------
ALTER TABLE question_images
  ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'ok',  -- ok|missing|broken|low_res|duplicate|unverified
  ADD COLUMN IF NOT EXISTS last_checked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS content_hash     TEXT,
  ADD COLUMN IF NOT EXISTS replaced_from_url TEXT,   -- original URL preserved when the file is replaced
  ADD COLUMN IF NOT EXISTS reconstructed    BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- Part C — mistake notebook
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mistake_entries (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  question_id     TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  category        TEXT NOT NULL DEFAULT 'conceptual', -- conceptual|calculation|formula_forgotten|misread|time_management|incorrect_guess|other
  personal_note   TEXT,
  mistake_count   INT  NOT NULL DEFAULT 1,
  last_answer     JSONB,
  last_mistake_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  corrected_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS mistake_entries_user_idx ON mistake_entries(user_id, last_mistake_at DESC);

-- ---------------------------------------------------------------------------
-- Part D — spaced repetition
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revision_schedule (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  question_id        TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  source             TEXT NOT NULL DEFAULT 'manual', -- mistake|bookmark|chapter|subject|manual|custom|exam
  due_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  interval_days      INT  NOT NULL DEFAULT 1,
  consecutive_correct INT NOT NULL DEFAULT 0,
  consecutive_wrong  INT  NOT NULL DEFAULT 0,
  self_rating        TEXT,   -- easy|medium|difficult
  last_result        BOOLEAN,
  last_reviewed_at   TIMESTAMPTZ,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS revision_schedule_due_idx ON revision_schedule(user_id, due_at) WHERE active;

CREATE TABLE IF NOT EXISTS revision_attempts (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  question_id       TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  schedule_id       TEXT REFERENCES revision_schedule(id) ON DELETE SET NULL,
  was_correct       BOOLEAN,
  hints_used        INT NOT NULL DEFAULT 0,
  time_spent_seconds INT NOT NULL DEFAULT 0,
  self_rating       TEXT,
  reviewed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revision_attempts_user_idx ON revision_attempts(user_id, reviewed_at DESC);

-- ---------------------------------------------------------------------------
-- Part F — saved custom test configurations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_test_configs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  config      JSONB NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_test_configs_user_idx ON saved_test_configs(user_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Part G — formula cards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS formula_cards (
  id          TEXT PRIMARY KEY,
  subject_key TEXT NOT NULL,          -- physics|chemistry|mathematics
  chapter_key TEXT NOT NULL,
  topic       TEXT,
  title       TEXT NOT NULL,
  formula     TEXT NOT NULL,          -- LaTeX (rendered with KaTeX)
  explanation TEXT,
  conditions  TEXT,                   -- when it applies / domain restrictions
  units       TEXT,
  tags        JSONB NOT NULL DEFAULT '[]',
  source      TEXT,                   -- citation for the fact
  status      TEXT NOT NULL DEFAULT 'needs_review',  -- published|needs_review|rejected
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS formula_cards_chapter_idx ON formula_cards(subject_key, chapter_key);
CREATE INDEX IF NOT EXISTS formula_cards_status_idx ON formula_cards(status);

CREATE TABLE IF NOT EXISTS formula_progress (
  user_id     TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  card_id     TEXT NOT NULL REFERENCES formula_cards(id) ON DELETE CASCADE,
  favorite    BOOLEAN NOT NULL DEFAULT FALSE,
  learned     BOOLEAN NOT NULL DEFAULT FALSE,
  personal_note TEXT,
  quiz_seen   INT NOT NULL DEFAULT 0,
  quiz_correct INT NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id)
);

-- ---------------------------------------------------------------------------
-- Part K — progressive hints
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS question_hints (
  question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  hint1       TEXT NOT NULL,   -- relevant concept
  hint2       TEXT,            -- direction of approach
  hint3       TEXT,            -- key formula / intermediate step
  source      TEXT NOT NULL DEFAULT 'derived', -- derived|ai|admin
  status      TEXT NOT NULL DEFAULT 'ai_generated', -- ai_generated|independently_checked|expert_verified|needs_review
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- attempts: hint usage + offline sync key
ALTER TABLE attempts
  ADD COLUMN IF NOT EXISTS hints_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS attempts_client_key_idx ON attempts(client_key) WHERE client_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Part J — syllabus tracker & daily targets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chapter_progress (
  user_id     TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'not_started',  -- not_started|learning|completed|revision_required|strong
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chapter_id)
);

CREATE TABLE IF NOT EXISTS daily_targets (
  user_id         TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  target_questions INT NOT NULL DEFAULT 20,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Part L — chat attachments (share question / result / revision)
-- ---------------------------------------------------------------------------
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS attachment JSONB;

-- ---------------------------------------------------------------------------
-- Grants + RLS for every new table (house pattern from migration 0003)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'solution_revisions','solution_gen_log','mistake_entries','revision_schedule',
    'revision_attempts','saved_test_configs','formula_cards','formula_progress',
    'question_hints','chapter_progress','daily_targets'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO jee_app', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "app full access" ON %I', t);
    EXECUTE format('CREATE POLICY "app full access" ON %I FOR ALL TO jee_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
