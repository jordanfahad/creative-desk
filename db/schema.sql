-- ─────────────────────────────────────────────────────────────────────
-- LEGACY — NOT the source of truth.
-- The live database is Supabase Postgres. This SQLite DDL is kept ONLY for
-- local-script reference (e.g. scripts/seed.mjs) and historical context. Do
-- not treat it as authoritative; schema changes happen in Supabase.
-- ─────────────────────────────────────────────────────────────────────
--
-- Creative Desk — local data model & context store (SQLite).
-- Run once via lib/db.ts (auto-applied on first import). Single-user,
-- local-first; no RLS needed.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── brand_kit ────────────────────────────────────────────────────────
-- Stored ONCE, re-injected into every generation. This is the "give the model
-- the guidelines once" mechanism — store here, lib/context.ts re-reads it
-- on every brief. No model training involved.
CREATE TABLE IF NOT EXISTS brand_kit (
  id           INTEGER PRIMARY KEY CHECK (id = 1), -- single row
  clinic_name  TEXT,
  logo_path    TEXT,               -- uploaded brand logo (transparent PNG) for overlays
  tagline      TEXT,
  voice        TEXT,               -- tone of voice description
  colors       TEXT,               -- JSON array of hex values
  fonts        TEXT,               -- JSON array of font names
  do_not_say   TEXT,               -- JSON array — forbidden claims (medical-safety guardrails)
  boilerplate  TEXT,               -- standard clinic blurb / contact / disclaimers
  updated_at   TEXT DEFAULT (datetime('now'))
);

-- ── guidelines ───────────────────────────────────────────────────────
-- Versioned creative/brand guidelines. Only rows with active = 1 are
-- injected into the context block.
CREATE TABLE IF NOT EXISTS guidelines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'general', -- creative | ceo | general (who issued it)
  doc_path   TEXT,                            -- uploaded source PDF on disk, if any
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── assets ───────────────────────────────────────────────────────────
-- Uploaded clinic / doctor shots. `local_path` is the file on disk;
-- `public_url` is set only when a tunnel/host makes it reachable for renders.
CREATE TABLE IF NOT EXISTS assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT NOT NULL,
  local_path  TEXT NOT NULL,       -- e.g. storage/assets/clinic-01.jpg
  public_url  TEXT,                -- set at submit time (tunnel/host)
  kind        TEXT NOT NULL DEFAULT 'clinic',  -- clinic | doctor | product | other
  quality     TEXT NOT NULL DEFAULT 'unrated', -- good | ok | poor | unrated  (audit tag)
  notes       TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ── jobs ─────────────────────────────────────────────────────────────
-- A creative job. mode = static (GMB trust still) | dynamic (awareness video).
-- status is the human gate: only 'approved' jobs may fire renders.
CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('static','dynamic')),
  goal        TEXT,                -- e.g. "GMB trust", "awareness — new patients"
  brief_notes TEXT,               -- human direction fed into the brief prompt
  brief_doc_path TEXT,            -- uploaded creative-director brief (PDF) on disk
  brief_doc_text TEXT,            -- extracted text from that PDF, injected into the brief prompt
  -- production config (how the renders are produced/finished):
  image_mode    TEXT NOT NULL DEFAULT 'text',  -- text (generate) | edit (fix uploads) | generate (from refs)
  combine       INTEGER NOT NULL DEFAULT 0,    -- 0 = fix each image separately, 1 = combine into one
  platform      TEXT NOT NULL DEFAULT 'gbp_square',
  logo_enabled  INTEGER NOT NULL DEFAULT 1,
  logo_position TEXT NOT NULL DEFAULT 'bottom-right',
  asset_ids   TEXT NOT NULL DEFAULT '[]', -- JSON array of asset ids selected as sources
  status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','briefed','approved','submitted','done','failed')),
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- ── briefs ───────────────────────────────────────────────────────────
-- The model's structured output for a job. `content` is the JSON brief; the
-- human may edit it before approving. credit_estimate is a planning number.
CREATE TABLE IF NOT EXISTS briefs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,   -- JSON (see lib/context.ts BriefSchema)
  credit_estimate REAL NOT NULL DEFAULT 0,
  model           TEXT,            -- model id used to generate
  edited          INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ── renders ──────────────────────────────────────────────────────────
-- One fal.ai render request per row. request_id/status_url come from
-- submit; status/result_url get filled in by poll.
CREATE TABLE IF NOT EXISTS renders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  brief_id    INTEGER REFERENCES briefs(id) ON DELETE SET NULL,
  shot_index  INTEGER NOT NULL DEFAULT 0,  -- which clip/still in the brief
  request_id  TEXT,
  status_url  TEXT,
  status      TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','processing','completed','failed')),
  result_url  TEXT,
  meta        TEXT,                -- JSON — raw submit/poll payloads for debugging
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_briefs_job   ON briefs(job_id);
CREATE INDEX IF NOT EXISTS idx_renders_job  ON renders(job_id);
CREATE INDEX IF NOT EXISTS idx_assets_kind  ON assets(kind);
