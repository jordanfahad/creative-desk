import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Local-first store. One SQLite file on disk replaces Supabase Postgres.
// The connection is created once per server process and cached on globalThis
// so Next's dev hot-reload doesn't open a new handle on every request.

const DB_PATH = resolve(process.env.CREATIVE_DESK_DB || "./data/creative-desk.db");

declare global {
  // eslint-disable-next-line no-var
  var __creativeDeskDb: Database.Database | undefined;
}

function open(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const database = new Database(DB_PATH);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");

  // Apply schema (all statements are IF NOT EXISTS — safe to run every boot).
  const schemaPath = join(process.cwd(), "db", "schema.sql");
  database.exec(readFileSync(schemaPath, "utf8"));

  // Lightweight migrations: add columns to existing DBs created before they
  // were part of the schema. ALTER TABLE ADD COLUMN is idempotent here because
  // we check PRAGMA table_info first.
  const jobCols = new Set(
    (database.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!jobCols.has("brief_doc_path")) database.exec("ALTER TABLE jobs ADD COLUMN brief_doc_path TEXT");
  if (!jobCols.has("brief_doc_text")) database.exec("ALTER TABLE jobs ADD COLUMN brief_doc_text TEXT");

  const gCols = new Set(
    (database.prepare("PRAGMA table_info(guidelines)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!gCols.has("source")) database.exec("ALTER TABLE guidelines ADD COLUMN source TEXT NOT NULL DEFAULT 'general'");
  if (!gCols.has("doc_path")) database.exec("ALTER TABLE guidelines ADD COLUMN doc_path TEXT");

  // production-config + logo columns
  const has = (table: string, col: string) =>
    (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
  if (!has("brand_kit", "logo_path")) database.exec("ALTER TABLE brand_kit ADD COLUMN logo_path TEXT");
  if (!has("jobs", "image_mode")) database.exec("ALTER TABLE jobs ADD COLUMN image_mode TEXT NOT NULL DEFAULT 'text'");
  if (!has("jobs", "combine")) database.exec("ALTER TABLE jobs ADD COLUMN combine INTEGER NOT NULL DEFAULT 0");
  if (!has("jobs", "platform")) database.exec("ALTER TABLE jobs ADD COLUMN platform TEXT NOT NULL DEFAULT 'gmb_square'");
  if (!has("jobs", "logo_enabled")) database.exec("ALTER TABLE jobs ADD COLUMN logo_enabled INTEGER NOT NULL DEFAULT 1");
  if (!has("jobs", "logo_position")) database.exec("ALTER TABLE jobs ADD COLUMN logo_position TEXT NOT NULL DEFAULT 'bottom-right'");

  // ── intent x media x multi-channel model ──
  if (!has("jobs", "intent")) database.exec("ALTER TABLE jobs ADD COLUMN intent TEXT NOT NULL DEFAULT 'create'");
  if (!has("jobs", "media")) database.exec("ALTER TABLE jobs ADD COLUMN media TEXT NOT NULL DEFAULT 'image'");
  if (!has("jobs", "platforms")) database.exec("ALTER TABLE jobs ADD COLUMN platforms TEXT NOT NULL DEFAULT '[]'");
  if (!has("jobs", "video_mode")) database.exec("ALTER TABLE jobs ADD COLUMN video_mode TEXT NOT NULL DEFAULT 'animate'");
  if (!has("assets", "media")) database.exec("ALTER TABLE assets ADD COLUMN media TEXT NOT NULL DEFAULT 'image'");
  if (!has("renders", "platform")) database.exec("ALTER TABLE renders ADD COLUMN platform TEXT");
  if (!has("renders", "error")) database.exec("ALTER TABLE renders ADD COLUMN error TEXT");
  if (!has("renders", "attempts")) database.exec("ALTER TABLE renders ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
  if (!has("renders", "source_asset_id")) database.exec("ALTER TABLE renders ADD COLUMN source_asset_id INTEGER");

  // Backfill the new axes from the legacy mode/image_mode on first run.
  database.exec(
    "UPDATE jobs SET media = CASE WHEN mode = 'dynamic' THEN 'video' ELSE 'image' END WHERE media IS NULL OR media = ''",
  );
  database.exec(
    "UPDATE jobs SET intent = CASE WHEN image_mode = 'text' THEN 'create' ELSE 'optimize' END WHERE intent IS NULL OR intent = ''",
  );
  // Seed platforms[] from the legacy single platform where empty.
  database.exec(
    "UPDATE jobs SET platforms = json_array(platform) WHERE (platforms IS NULL OR platforms = '[]') AND platform IS NOT NULL",
  );

  return database;
}

export const db: Database.Database = globalThis.__creativeDeskDb ?? open();
if (process.env.NODE_ENV !== "production") globalThis.__creativeDeskDb = db;

// ── tiny typed helpers ───────────────────────────────────────────────

export interface BrandKit {
  id: number;
  clinic_name: string | null;
  logo_path: string | null;
  tagline: string | null;
  voice: string | null;
  colors: string | null;
  fonts: string | null;
  do_not_say: string | null;
  boilerplate: string | null;
  updated_at: string;
}

export interface Guideline {
  id: number;
  title: string;
  body: string;
  source: string; // creative | ceo | general
  doc_path: string | null;
  active: number;
  created_at: string;
}

export interface Asset {
  id: number;
  filename: string;
  local_path: string;
  public_url: string | null;
  kind: string;
  media: "image" | "video";
  quality: string;
  notes: string | null;
  created_at: string;
}

export interface Job {
  id: number;
  title: string;
  mode: "static" | "dynamic";
  goal: string | null;
  brief_notes: string | null;
  brief_doc_path: string | null;
  brief_doc_text: string | null;
  intent: "optimize" | "create";
  media: "image" | "video";
  platforms: string; // JSON array of platform keys
  video_mode: "passthrough" | "ai_enhance" | "animate" | "generate";
  image_mode: "text" | "edit" | "generate"; // legacy, derived
  combine: number;
  platform: string; // legacy single
  logo_enabled: number;
  logo_position: string;
  asset_ids: string; // JSON array
  status: "draft" | "briefed" | "approved" | "submitted" | "done" | "failed";
  created_at: string;
  updated_at: string;
}

export interface Brief {
  id: number;
  job_id: number;
  content: string; // JSON
  credit_estimate: number;
  model: string | null;
  edited: number;
  created_at: string;
}

export interface Render {
  id: number;
  job_id: number;
  brief_id: number | null;
  shot_index: number;
  request_id: string | null;
  status_url: string | null;
  status: "queued" | "processing" | "completed" | "failed";
  result_url: string | null;
  platform: string | null;
  source_asset_id: number | null;
  error: string | null;
  attempts: number;
  meta: string | null;
  created_at: string;
  updated_at: string;
}

export function getJob(id: number): Job | undefined {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job | undefined;
}

export function getAssetsByIds(ids: number[]): Asset[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM assets WHERE id IN (${placeholders})`)
    .all(...ids) as Asset[];
}

// ── read helpers for the dashboard (server components) ───────────────

export function getBrandKit(): BrandKit | undefined {
  return db.prepare("SELECT * FROM brand_kit WHERE id = 1").get() as BrandKit | undefined;
}

export function listGuidelines(): Guideline[] {
  return db.prepare("SELECT * FROM guidelines ORDER BY created_at").all() as Guideline[];
}

export function listAssets(): Asset[] {
  return db.prepare("SELECT * FROM assets ORDER BY created_at DESC").all() as Asset[];
}

export function listJobs(): Job[] {
  return db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all() as Job[];
}

export function getLatestBrief(jobId: number): Brief | undefined {
  return db
    .prepare("SELECT * FROM briefs WHERE job_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(jobId) as Brief | undefined;
}

export function listRenders(jobId: number): Render[] {
  return db
    .prepare("SELECT * FROM renders WHERE job_id = ? ORDER BY shot_index")
    .all(jobId) as Render[];
}

// Web path for an asset's local file, served by app/api/storage/[...path].
// e.g. local_path "storage/assets/x.jpg" -> "/api/storage/assets/x.jpg".
export function assetWebPath(localPath: string): string {
  const rel = localPath.replace(/^storage[\\/]/, "").replace(/\\/g, "/");
  return `/api/storage/${rel}`;
}

// The channel keys a job exports to (multi-select), with legacy fallback.
export function jobPlatformKeys(job: Job): string[] {
  try {
    const v = JSON.parse(job.platforms || "[]");
    if (Array.isArray(v) && v.length) return v.map(String);
  } catch {
    /* fall through */
  }
  return job.platform ? [job.platform] : ["gmb_square"];
}
