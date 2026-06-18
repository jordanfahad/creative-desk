"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { supabase } from "./db";
import { BUCKET } from "./supabase";
import { getActiveProjectId, PROJECT_COOKIE, slugify } from "./project";
import { uploadBuffer, uploadPrivate, PRIVATE_BUCKET } from "./storage";
import { parseBrief } from "./context";
import { extractPdfText } from "./pdf";
import { PLATFORMS, LOGO_POSITIONS, defaultPlatforms } from "./platform";
import { STYLE_KEYS } from "./style";

const INTENTS = new Set(["optimize", "create"]);
const MEDIAS = new Set(["image", "video"]);
const VIDEO_MODES = new Set(["passthrough", "ai_enhance", "animate", "generate"]);
const GUIDELINE_SOURCES = new Set(["creative", "ceo", "general"]);

const MAX_FILE_BYTES = 60 * 1024 * 1024;
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
function contentTypeOf(f: File): string {
  if (f.type) return f.type;
  const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
  return (
    { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".pdf": "application/pdf" }[ext] || "application/octet-stream"
  );
}
async function uploadFile(file: File, folder: string): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload";
  const key = `${folder}/${randomUUID().slice(0, 8)}-${safe}`;
  return uploadBuffer(key, buf, contentTypeOf(file));
}

function csvToJson(raw: FormDataEntryValue | null): string {
  const s = (raw ?? "").toString().trim();
  if (!s) return "[]";
  return JSON.stringify(s.split(",").map((x) => x.trim()).filter(Boolean));
}
function normalizeSource(raw: FormDataEntryValue | null): string {
  const s = (raw ?? "general").toString();
  return GUIDELINE_SOURCES.has(s) ? s : "general";
}
function readSettings(formData: FormData) {
  const pos = (formData.get("logo_position") ?? "bottom-right").toString();
  const vm = (formData.get("video_mode") ?? "animate").toString();
  const style = (formData.get("style") ?? "auto").toString();
  const platforms = formData.getAll("platforms").map((v) => v.toString()).filter((k) => PLATFORMS[k]);
  return {
    platforms: JSON.stringify(platforms.length ? platforms : defaultPlatforms()),
    logo_enabled: formData.get("logo_enabled") ? 1 : 0,
    logo_position: (LOGO_POSITIONS as readonly string[]).includes(pos) ? pos : "bottom-right",
    combine: formData.get("combine") ? 1 : 0,
    video_mode: VIDEO_MODES.has(vm) ? vm : "animate",
    style: STYLE_KEYS.includes(style) ? style : "auto",
  };
}
const now = () => new Date().toISOString();

// ── brand kit + logo + guidelines ──

export async function saveBrandKit(formData: FormData): Promise<void> {
  const pid = await getActiveProjectId();
  const get = (k: string) => (formData.get(k) ?? "").toString().trim() || null;
  await supabase
    .from("brand_kit")
    .update({
      clinic_name: get("clinic_name"),
      tagline: get("tagline"),
      voice: get("voice"),
      colors: csvToJson(formData.get("colors")),
      fonts: csvToJson(formData.get("fonts")),
      do_not_say: csvToJson(formData.get("do_not_say")),
      boilerplate: get("boilerplate"),
      updated_at: now(),
    })
    .eq("project_id", pid);
  revalidatePath("/brand");
}

export async function uploadLogo(formData: FormData): Promise<void> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  // Raster image only (no SVG — a stored SVG served from storage is an XSS vector), with a size cap.
  const ok = /^image\/(png|jpe?g|webp|gif)$/i.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
  if (!ok || file.size > MAX_FILE_BYTES) return;
  const pid = await getActiveProjectId();
  const url = await uploadFile(file, "brand");
  await supabase.from("brand_kit").update({ logo_path: url, updated_at: now() }).eq("project_id", pid);
  revalidatePath("/brand");
}

export async function removeLogo(): Promise<void> {
  const pid = await getActiveProjectId();
  await supabase.from("brand_kit").update({ logo_path: null, updated_at: now() }).eq("project_id", pid);
  revalidatePath("/brand");
}

export async function addGuideline(formData: FormData): Promise<void> {
  const title = (formData.get("title") ?? "").toString().trim();
  const body = (formData.get("body") ?? "").toString().trim();
  if (!title || !body) return;
  const pid = await getActiveProjectId();
  await supabase.from("guidelines").insert({ project_id: pid, title, body, source: normalizeSource(formData.get("source")), active: 1 });
  revalidatePath("/brand");
}

export async function uploadGuideline(formData: FormData): Promise<void> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) return;
  const title = (formData.get("title") ?? "").toString().trim() || file.name.replace(/\.pdf$/i, "");
  const buf = Buffer.from(await file.arrayBuffer());
  let text = "";
  try {
    text = await extractPdfText(buf);
  } catch {
    text = "";
  }
  if (!text) return;
  const pid = await getActiveProjectId();
  // Confidential — store in the private bucket under a non-guessable key.
  const key = await uploadPrivate(`guidelines/${randomUUID()}.pdf`, buf, "application/pdf");
  await supabase.from("guidelines").insert({ project_id: pid, title, body: text, source: normalizeSource(formData.get("source")), doc_path: key, active: 1 });
  revalidatePath("/brand");
}

export async function toggleGuideline(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  const { data } = await supabase.from("guidelines").select("active").eq("id", id).maybeSingle();
  await supabase.from("guidelines").update({ active: (data?.active ?? 1) ? 0 : 1 }).eq("id", id);
  revalidatePath("/brand");
}

export async function deleteGuideline(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await supabase.from("guidelines").delete().eq("id", id);
  revalidatePath("/brand");
}

// ── assets ──

export async function uploadAsset(formData: FormData): Promise<void> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  const m = mediaOf(file);
  if (!m || file.size > MAX_FILE_BYTES) return;
  const pid = await getActiveProjectId();
  const url = await uploadFile(file, "assets");
  await supabase.from("assets").insert({
    project_id: pid,
    filename: file.name,
    local_path: url,
    kind: (formData.get("kind") ?? "clinic").toString(),
    media: m,
    quality: (formData.get("quality") ?? "unrated").toString(),
    notes: (formData.get("notes") ?? "").toString().trim() || null,
  });
  revalidatePath("/assets");
}

export async function uploadJobAsset(formData: FormData): Promise<void> {
  const jobId = Number(formData.get("job_id"));
  if (!Number.isFinite(jobId)) return;
  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return;

  const { data: job } = await supabase.from("jobs").select("asset_ids, media, project_id").eq("id", jobId).maybeSingle();
  if (!job) return;

  const newIds: number[] = [];
  for (const file of files.slice(0, MAX_FILES_PER_UPLOAD)) {
    const m = mediaOf(file);
    if (!m || m !== job.media || file.size > MAX_FILE_BYTES) continue;
    const url = await uploadFile(file, "assets");
    const { data } = await supabase
      .from("assets")
      .insert({ project_id: job.project_id, filename: file.name, local_path: url, kind: "creative", media: m, quality: "good" })
      .select("id")
      .single();
    if (data?.id) newIds.push(Number(data.id));
  }
  if (!newIds.length) return;
  const ids = [...(JSON.parse(job.asset_ids || "[]") as number[]), ...newIds];
  // Don't mutate intent here — createJob already set it; uploading a source must not flip a job's type.
  await supabase.from("jobs").update({ asset_ids: JSON.stringify(ids), updated_at: now() }).eq("id", jobId);
  revalidatePath(`/jobs/${jobId}`);
}

export async function removeJobAsset(formData: FormData): Promise<void> {
  const jobId = Number(formData.get("job_id"));
  const assetId = Number(formData.get("asset_id"));
  if (!Number.isFinite(jobId) || !Number.isFinite(assetId)) return;
  const { data: job } = await supabase.from("jobs").select("asset_ids").eq("id", jobId).maybeSingle();
  if (!job) return;
  const ids = (JSON.parse(job.asset_ids || "[]") as number[]).filter((x) => x !== assetId);
  await supabase.from("jobs").update({ asset_ids: JSON.stringify(ids) }).eq("id", jobId);
  revalidatePath(`/jobs/${jobId}`);
}

export async function updateAsset(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await supabase.from("assets").update({
    kind: (formData.get("kind") ?? "clinic").toString(),
    quality: (formData.get("quality") ?? "unrated").toString(),
    notes: (formData.get("notes") ?? "").toString().trim() || null,
  }).eq("id", id);
  revalidatePath("/assets");
}

export async function deleteAsset(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await supabase.from("assets").delete().eq("id", id);
  revalidatePath("/assets");
}

// ── jobs ──

export async function createJob(formData: FormData): Promise<void> {
  const title = (formData.get("title") ?? "").toString().trim();
  const intent = (formData.get("intent") ?? "create").toString();
  const media = (formData.get("media") ?? "image").toString();
  if (!title || !INTENTS.has(intent) || !MEDIAS.has(media)) return;
  const pid = await getActiveProjectId();
  const mode = media === "video" ? "dynamic" : "static";
  const image_mode = intent === "create" ? "text" : "edit";
  const video_mode = intent === "optimize" ? "passthrough" : "animate";

  const { data } = await supabase
    .from("jobs")
    .insert({
      project_id: pid,
      title, mode, intent, media, image_mode, video_mode,
      platforms: JSON.stringify(defaultPlatforms()),
      asset_ids: "[]", status: "draft", combine: 0, platform: "gmb_square",
      logo_enabled: 1, logo_position: "bottom-right",
    })
    .select("id")
    .single();

  revalidatePath("/");
  if (data?.id) redirect(`/jobs/${data.id}`);
}

// ── projects (brands / workspaces) ──

export async function createProject(formData: FormData): Promise<void> {
  const name = (formData.get("name") ?? "").toString().trim();
  if (!name) return;
  let slug = slugify(name);
  const { data: clash } = await supabase.from("cd_projects").select("id").eq("slug", slug).maybeSingle();
  if (clash) slug = `${slug}-${randomUUID().slice(0, 4)}`;
  const { data: proj } = await supabase.from("cd_projects").insert({ name, slug }).select("id").single();
  if (!proj?.id) return;
  // Every project owns exactly one brand_kit row (id kept = project id so ids stay unique).
  await supabase.from("brand_kit").insert({ id: proj.id, project_id: proj.id, clinic_name: name, updated_at: now() });
  (await cookies()).set(PROJECT_COOKIE, String(proj.id), { sameSite: "lax", path: "/" });
  revalidatePath("/");
  redirect("/brand");
}

export async function switchProject(formData: FormData): Promise<void> {
  const id = Number(formData.get("project_id"));
  if (!Number.isFinite(id)) return;
  (await cookies()).set(PROJECT_COOKIE, String(id), { sameSite: "lax", path: "/" });
  revalidatePath("/", "layout");
  redirect("/");
}

// public storage key from a stored public URL (null for private keys / nothing)
function pubKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : url.slice(i + marker.length);
}

export async function deleteProject(formData: FormData): Promise<void> {
  const id = Number(formData.get("project_id"));
  if (!Number.isFinite(id)) return;
  const { data: all } = await supabase.from("cd_projects").select("id");
  if (!all || all.length <= 1) return; // keep at least one project

  const { data: jobs } = await supabase.from("jobs").select("id, brief_doc_path").eq("project_id", id);
  const jobIds = (jobs ?? []).map((j) => j.id);

  // collect storage objects to remove (best-effort)
  const pubKeys: string[] = [];
  const privKeys: string[] = [];
  const { data: assets } = await supabase.from("assets").select("local_path").eq("project_id", id);
  for (const a of assets ?? []) { const k = pubKey(a.local_path); if (k) pubKeys.push(k); }
  if (jobIds.length) {
    const { data: renders } = await supabase.from("renders").select("result_url").in("job_id", jobIds);
    for (const r of renders ?? []) { const k = pubKey(r.result_url); if (k) pubKeys.push(k); }
  }
  const { data: bk } = await supabase.from("brand_kit").select("logo_path").eq("project_id", id).maybeSingle();
  { const k = pubKey(bk?.logo_path); if (k) pubKeys.push(k); }
  const { data: guides } = await supabase.from("guidelines").select("doc_path").eq("project_id", id);
  for (const g of guides ?? []) { if (g.doc_path && !/^https?:/.test(g.doc_path)) privKeys.push(g.doc_path); }
  for (const j of jobs ?? []) { if (j.brief_doc_path && !/^https?:/.test(j.brief_doc_path)) privKeys.push(j.brief_doc_path); }

  // delete DB rows (children first)
  if (jobIds.length) {
    await supabase.from("renders").delete().in("job_id", jobIds);
    await supabase.from("briefs").delete().in("job_id", jobIds);
  }
  await supabase.from("jobs").delete().eq("project_id", id);
  await supabase.from("assets").delete().eq("project_id", id);
  await supabase.from("guidelines").delete().eq("project_id", id);
  await supabase.from("brand_kit").delete().eq("project_id", id);
  await supabase.from("cd_projects").delete().eq("id", id);

  // remove storage (best-effort; ignore failures)
  if (pubKeys.length) await supabase.storage.from(BUCKET).remove(pubKeys);
  if (privKeys.length) await supabase.storage.from(PRIVATE_BUCKET).remove(privKeys);

  // if the deleted project was active, switch to the first remaining one
  const remaining = all.filter((p) => p.id !== id);
  const activeRaw = (await cookies()).get(PROJECT_COOKIE)?.value;
  if (!activeRaw || Number(activeRaw) === id) {
    (await cookies()).set(PROJECT_COOKIE, String(remaining[0].id), { sameSite: "lax", path: "/" });
  }
  revalidatePath("/", "layout");
  redirect("/projects");
}

export async function setProduction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  const s = readSettings(formData);
  await supabase.from("jobs").update({ ...s, updated_at: now() }).eq("id", id);
  revalidatePath(`/jobs/${id}`);
}

export async function setDirection(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await supabase.from("jobs").update({ brief_notes: (formData.get("brief_notes") ?? "").toString().trim() || null, updated_at: now() }).eq("id", id);
  revalidatePath(`/jobs/${id}`);
}

export async function deleteJob(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await supabase.from("jobs").delete().eq("id", id);
  revalidatePath("/");
  redirect("/");
}

// ── creative director brief PDF ──

export async function uploadBriefDoc(formData: FormData): Promise<void> {
  const jobId = Number(formData.get("job_id"));
  const file = formData.get("file");
  if (!Number.isFinite(jobId) || !(file instanceof File) || file.size === 0) return;
  if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) return;
  const buf = Buffer.from(await file.arrayBuffer());
  let text = "";
  try {
    text = await extractPdfText(buf);
  } catch {
    text = "";
  }
  // Confidential — store in the private bucket under a non-guessable key.
  const key = await uploadPrivate(`briefs/${randomUUID()}.pdf`, buf, "application/pdf");
  await supabase.from("jobs").update({ brief_doc_path: key, brief_doc_text: text || null, updated_at: now() }).eq("id", jobId);
  revalidatePath(`/jobs/${jobId}`);
}

export async function removeBriefDoc(formData: FormData): Promise<void> {
  const jobId = Number(formData.get("job_id"));
  if (!Number.isFinite(jobId)) return;
  await supabase.from("jobs").update({ brief_doc_path: null, brief_doc_text: null, updated_at: now() }).eq("id", jobId);
  revalidatePath(`/jobs/${jobId}`);
}

// ── brief edit ──

export async function saveBriefEdit(formData: FormData): Promise<void> {
  const briefId = Number(formData.get("brief_id"));
  const jobId = Number(formData.get("job_id"));
  const content = (formData.get("content") ?? "").toString();
  if (!Number.isFinite(briefId)) return;
  const data = parseBrief(content);
  if (!data) return;
  const credit = data.mode === "static" ? data.shots.length : data.shots.length * 4;
  await supabase.from("briefs").update({ content: JSON.stringify(data), credit_estimate: credit, edited: 1 }).eq("id", briefId);
  if (Number.isFinite(jobId)) revalidatePath(`/jobs/${jobId}`);
}
