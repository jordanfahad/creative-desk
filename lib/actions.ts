"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { BriefSchema } from "./context";
import { extractPdfText } from "./pdf";
import { PLATFORMS, LOGO_POSITIONS, defaultPlatforms } from "./platform";

const INTENTS = new Set(["optimize", "create"]);
const MEDIAS = new Set(["image", "video"]);
const VIDEO_MODES = new Set(["passthrough", "ai_enhance", "animate", "generate"]);

const MAX_FILE_BYTES = 60 * 1024 * 1024; // 60MB (under the 50MB? no — server action cap is 50MB; keep files ≤ that)
const MAX_FILES_PER_UPLOAD = 12;

function isImageFile(f: File): boolean {
  return f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name);
}
function isVideoFile(f: File): boolean {
  return f.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(f.name);
}
function mediaOf(f: File): "image" | "video" | null {
  if (isImageFile(f)) return "image";
  if (isVideoFile(f)) return "video";
  return null;
}

// Job-page settings (channels, logo, video mode).
function readSettings(formData: FormData): {
  platforms: string;
  logo_enabled: number;
  logo_position: string;
  combine: number;
  video_mode: string;
} {
  const pos = (formData.get("logo_position") ?? "bottom-right").toString();
  const vm = (formData.get("video_mode") ?? "animate").toString();
  const platforms = formData
    .getAll("platforms")
    .map((v) => v.toString())
    .filter((k) => PLATFORMS[k]);
  return {
    platforms: JSON.stringify(platforms.length ? platforms : defaultPlatforms()),
    logo_enabled: formData.get("logo_enabled") ? 1 : 0,
    logo_position: (LOGO_POSITIONS as readonly string[]).includes(pos) ? pos : "bottom-right",
    combine: formData.get("combine") ? 1 : 0,
    video_mode: VIDEO_MODES.has(vm) ? vm : "animate",
  };
}

// All dashboard writes. Reads live in server components via lib/db helpers.

const STORAGE_ROOT = resolve(process.env.CREATIVE_DESK_STORAGE || "./storage");

function csvToJson(raw: FormDataEntryValue | null): string {
  const s = (raw ?? "").toString().trim();
  if (!s) return "[]";
  return JSON.stringify(
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
}

// ── brand kit + guidelines ───────────────────────────────────────────

export async function saveBrandKit(formData: FormData): Promise<void> {
  const get = (k: string) => (formData.get(k) ?? "").toString().trim() || null;
  db.prepare(
    `INSERT INTO brand_kit (id, clinic_name, tagline, voice, colors, fonts, do_not_say, boilerplate, updated_at)
     VALUES (1, @clinic_name, @tagline, @voice, @colors, @fonts, @do_not_say, @boilerplate, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       clinic_name=excluded.clinic_name, tagline=excluded.tagline, voice=excluded.voice,
       colors=excluded.colors, fonts=excluded.fonts, do_not_say=excluded.do_not_say,
       boilerplate=excluded.boilerplate, updated_at=datetime('now')`,
  ).run({
    clinic_name: get("clinic_name"),
    tagline: get("tagline"),
    voice: get("voice"),
    colors: csvToJson(formData.get("colors")),
    fonts: csvToJson(formData.get("fonts")),
    do_not_say: csvToJson(formData.get("do_not_say")),
    boilerplate: get("boilerplate"),
  });
  revalidatePath("/brand");
}

const GUIDELINE_SOURCES = new Set(["creative", "ceo", "general"]);

function normalizeSource(raw: FormDataEntryValue | null): string {
  const s = (raw ?? "general").toString();
  return GUIDELINE_SOURCES.has(s) ? s : "general";
}

export async function uploadLogo(formData: FormData): Promise<void> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  const isImg = file.type.startsWith("image/") || /\.(png|jpe?g|webp|svg)$/i.test(file.name);
  if (!isImg) return;

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "logo.png";
  const name = `${randomUUID().slice(0, 8)}-${safe}`;
  const dir = join(STORAGE_ROOT, "brand");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()));

  db.prepare(
    `INSERT INTO brand_kit (id, logo_path, updated_at) VALUES (1, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET logo_path = excluded.logo_path, updated_at = datetime('now')`,
  ).run(`storage/brand/${name}`);
  revalidatePath("/brand");
}

export async function removeLogo(): Promise<void> {
  db.prepare("UPDATE brand_kit SET logo_path = NULL, updated_at = datetime('now') WHERE id = 1").run();
  revalidatePath("/brand");
}

export async function addGuideline(formData: FormData): Promise<void> {
  const title = (formData.get("title") ?? "").toString().trim();
  const body = (formData.get("body") ?? "").toString().trim();
  const source = normalizeSource(formData.get("source"));
  if (!title || !body) return;
  db.prepare("INSERT INTO guidelines (title, body, source, active) VALUES (?, ?, ?, 1)").run(
    title,
    body,
    source,
  );
  revalidatePath("/brand");
}

// Upload a guideline document (PDF) — creative team or CEO. Its text is
// extracted and stored as the guideline body, re-injected into every brief.
export async function uploadGuideline(formData: FormData): Promise<void> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return;

  const source = normalizeSource(formData.get("source"));
  const title =
    (formData.get("title") ?? "").toString().trim() || file.name.replace(/\.pdf$/i, "");

  const buf = Buffer.from(await file.arrayBuffer());
  let text = "";
  try {
    text = await extractPdfText(buf);
  } catch {
    text = "";
  }
  if (!text) return; // nothing usable to inject — skip (scanned/image-only PDF)

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "guideline.pdf";
  const name = `${randomUUID().slice(0, 8)}-${safe}`;
  const dir = join(STORAGE_ROOT, "guidelines");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), buf);

  db.prepare(
    "INSERT INTO guidelines (title, body, source, doc_path, active) VALUES (?, ?, ?, ?, 1)",
  ).run(title, text, source, `storage/guidelines/${name}`);
  revalidatePath("/brand");
}

export async function toggleGuideline(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  db.prepare("UPDATE guidelines SET active = 1 - active WHERE id = ?").run(id);
  revalidatePath("/brand");
}

export async function deleteGuideline(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  db.prepare("DELETE FROM guidelines WHERE id = ?").run(id);
  revalidatePath("/brand");
}

// ── assets ───────────────────────────────────────────────────────────

export async function uploadAsset(formData: FormData): Promise<void> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  const m = mediaOf(file);
  if (!m || file.size > MAX_FILE_BYTES) return; // only image/video, within size cap

  const kind = (formData.get("kind") ?? "clinic").toString();
  const quality = (formData.get("quality") ?? "unrated").toString();
  const notes = (formData.get("notes") ?? "").toString().trim() || null;

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload";
  const name = `${randomUUID().slice(0, 8)}-${safe}`;
  const dir = join(STORAGE_ROOT, "assets");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()));

  db.prepare(
    "INSERT INTO assets (filename, local_path, kind, media, quality, notes) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(file.name, `storage/assets/${name}`, kind, m, quality, notes);
  revalidatePath("/assets");
}

// Upload creative(s) directly onto a job and attach them. Defaults the job to
// 'edit' mode (you uploaded photos to fix/optimize them).
export async function uploadJobAsset(formData: FormData): Promise<void> {
  const jobId = Number(formData.get("job_id"));
  if (!Number.isFinite(jobId)) return;
  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return;

  const job = db.prepare("SELECT asset_ids, media FROM jobs WHERE id = ?").get(jobId) as
    | { asset_ids: string; media: string }
    | undefined;
  if (!job) return;

  const dir = join(STORAGE_ROOT, "assets");
  await mkdir(dir, { recursive: true });
  const newIds: number[] = [];
  for (const file of files.slice(0, MAX_FILES_PER_UPLOAD)) {
    const m = mediaOf(file);
    if (!m || m !== job.media) continue; // only accept files matching the job's media
    if (file.size > MAX_FILE_BYTES) continue; // skip oversized
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "creative";
    const name = `${randomUUID().slice(0, 8)}-${safe}`;
    await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()));
    const res = db
      .prepare("INSERT INTO assets (filename, local_path, kind, media, quality) VALUES (?, ?, 'creative', ?, 'good')")
      .run(file.name, `storage/assets/${name}`, m);
    newIds.push(Number(res.lastInsertRowid));
  }
  if (!newIds.length) return;

  const ids = [...(JSON.parse(job.asset_ids || "[]") as number[]), ...newIds];
  // Uploading source creatives = an optimize job.
  db.prepare(
    "UPDATE jobs SET asset_ids = ?, intent = 'optimize', image_mode = 'edit', updated_at = datetime('now') WHERE id = ?",
  ).run(JSON.stringify(ids), jobId);
  revalidatePath(`/jobs/${jobId}`);
}

export async function removeJobAsset(formData: FormData): Promise<void> {
  const jobId = Number(formData.get("job_id"));
  const assetId = Number(formData.get("asset_id"));
  if (!Number.isFinite(jobId) || !Number.isFinite(assetId)) return;
  const job = db.prepare("SELECT asset_ids FROM jobs WHERE id = ?").get(jobId) as
    | { asset_ids: string }
    | undefined;
  if (!job) return;
  const ids = (JSON.parse(job.asset_ids || "[]") as number[]).filter((x) => x !== assetId);
  db.prepare("UPDATE jobs SET asset_ids = ? WHERE id = ?").run(JSON.stringify(ids), jobId);
  revalidatePath(`/jobs/${jobId}`);
}

export async function updateAsset(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  const kind = (formData.get("kind") ?? "clinic").toString();
  const quality = (formData.get("quality") ?? "unrated").toString();
  const notes = (formData.get("notes") ?? "").toString().trim() || null;
  db.prepare("UPDATE assets SET kind = ?, quality = ?, notes = ? WHERE id = ?").run(
    kind,
    quality,
    notes,
    id,
  );
  revalidatePath("/assets");
}

export async function deleteAsset(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  db.prepare("DELETE FROM assets WHERE id = ?").run(id);
  revalidatePath("/assets");
}

// ── jobs ─────────────────────────────────────────────────────────────

export async function createJob(formData: FormData): Promise<void> {
  const title = (formData.get("title") ?? "").toString().trim();
  const intent = (formData.get("intent") ?? "create").toString();
  const media = (formData.get("media") ?? "image").toString();
  if (!title || !INTENTS.has(intent) || !MEDIAS.has(media)) return;

  // Derive legacy axes + sensible defaults from intent x media.
  const mode = media === "video" ? "dynamic" : "static";
  const image_mode = intent === "create" ? "text" : "edit";
  const video_mode = intent === "optimize" ? "passthrough" : "animate";

  const res = db
    .prepare(
      `INSERT INTO jobs (title, mode, goal, brief_notes, asset_ids, status,
         intent, media, platforms, video_mode, image_mode, combine, platform, logo_enabled, logo_position)
       VALUES (?, ?, NULL, NULL, '[]', 'draft', ?, ?, ?, ?, ?, 0, 'gmb_square', 1, 'bottom-right')`,
    )
    .run(title, mode, intent, media, JSON.stringify(defaultPlatforms()), video_mode, image_mode);

  revalidatePath("/");
  redirect(`/jobs/${res.lastInsertRowid}`);
}

export async function setProduction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  const s = readSettings(formData);
  db.prepare(
    `UPDATE jobs SET platforms = ?, logo_enabled = ?, logo_position = ?, combine = ?, video_mode = ?,
       updated_at = datetime('now') WHERE id = ?`,
  ).run(s.platforms, s.logo_enabled, s.logo_position, s.combine, s.video_mode, id);
  revalidatePath(`/jobs/${id}`);
}

const JOB_STATUSES = new Set([
  "draft",
  "briefed",
  "approved",
  "submitted",
  "done",
  "failed",
]);

export async function setJobStatus(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const status = (formData.get("status") ?? "").toString();
  if (!Number.isFinite(id) || !JOB_STATUSES.has(status)) return;
  db.prepare("UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
    status,
    id,
  );
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/");
}

export async function setDirection(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  const notes = (formData.get("brief_notes") ?? "").toString().trim() || null;
  db.prepare("UPDATE jobs SET brief_notes = ?, updated_at = datetime('now') WHERE id = ?").run(notes, id);
  revalidatePath(`/jobs/${id}`);
}

export async function deleteJob(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
  revalidatePath("/");
  redirect("/");
}

// ── creative-director brief PDF ──────────────────────────────────────

export async function uploadBriefDoc(formData: FormData): Promise<void> {
  const jobId = Number(formData.get("job_id"));
  const file = formData.get("file");
  if (!Number.isFinite(jobId)) return;
  if (!(file instanceof File) || file.size === 0) return;

  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return;

  const buf = Buffer.from(await file.arrayBuffer());

  // Extract text up front; if the PDF is unreadable, keep the file but store
  // an empty string (the brief prompt simply won't get extra direction).
  let text = "";
  try {
    text = await extractPdfText(buf);
  } catch {
    text = "";
  }

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "brief.pdf";
  const name = `${randomUUID().slice(0, 8)}-${safe}`;
  const dir = join(STORAGE_ROOT, "briefs");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), buf);

  db.prepare(
    "UPDATE jobs SET brief_doc_path = ?, brief_doc_text = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(`storage/briefs/${name}`, text || null, jobId);

  revalidatePath(`/jobs/${jobId}`);
}

export async function removeBriefDoc(formData: FormData): Promise<void> {
  const jobId = Number(formData.get("job_id"));
  if (!Number.isFinite(jobId)) return;
  db.prepare(
    "UPDATE jobs SET brief_doc_path = NULL, brief_doc_text = NULL, updated_at = datetime('now') WHERE id = ?",
  ).run(jobId);
  revalidatePath(`/jobs/${jobId}`);
}

// ── brief edit ───────────────────────────────────────────────────────

export async function saveBriefEdit(formData: FormData): Promise<void> {
  const briefId = Number(formData.get("brief_id"));
  const jobId = Number(formData.get("job_id"));
  const content = (formData.get("content") ?? "").toString();
  if (!Number.isFinite(briefId)) return;

  // Validate the edited JSON against the brief schema before saving.
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return; // invalid JSON — ignore (UI keeps the prior content)
  }
  const result = BriefSchema.safeParse(parsed);
  if (!result.success) return;

  const credit =
    result.data.mode === "static"
      ? result.data.shots.length * 1
      : result.data.shots.length * 4;

  db.prepare(
    "UPDATE briefs SET content = ?, credit_estimate = ?, edited = 1 WHERE id = ?",
  ).run(JSON.stringify(result.data), credit, briefId);
  if (Number.isFinite(jobId)) revalidatePath(`/jobs/${jobId}`);
}
