import { supabase } from "./supabase";
import { publicUrl, resolveDocUrl } from "./storage";

// Supabase-backed data layer. All reads/writes are async via the admin client.
// (Schema lives in Supabase; see db/schema.sql for the equivalent DDL.)

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
  source: string;
  doc_path: string | null;
  active: number;
  created_at: string;
}

export interface Asset {
  id: number;
  filename: string;
  local_path: string; // public URL of the stored object
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
  platforms: string;
  video_mode: "passthrough" | "ai_enhance" | "animate" | "generate";
  image_mode: "text" | "edit" | "generate";
  combine: number;
  platform: string;
  logo_enabled: number;
  logo_position: string;
  asset_ids: string;
  status: "draft" | "briefed" | "approved" | "submitted" | "done" | "failed";
  created_at: string;
  updated_at: string;
}

export interface Brief {
  id: number;
  job_id: number;
  content: string;
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

// ── reads ──

// Surface DB errors in the server logs — the readers fall back to empty/undefined
// so a page never crashes, but a silent Supabase blip should still be diagnosable.
function logErr(where: string, error: unknown): void {
  if (error) console.error(`[db] ${where}:`, (error as { message?: string })?.message ?? error);
}

export async function getBrandKit(): Promise<BrandKit | undefined> {
  const { data, error } = await supabase.from("brand_kit").select("*").eq("id", 1).maybeSingle();
  logErr("getBrandKit", error);
  return (data as BrandKit) ?? undefined;
}

export async function listGuidelines(): Promise<Guideline[]> {
  const { data, error } = await supabase.from("guidelines").select("*").order("created_at");
  logErr("listGuidelines", error);
  return (data as Guideline[]) ?? [];
}

export async function listAssets(): Promise<Asset[]> {
  const { data, error } = await supabase.from("assets").select("*").order("created_at", { ascending: false });
  logErr("listAssets", error);
  return (data as Asset[]) ?? [];
}

export async function listJobs(): Promise<Job[]> {
  const { data, error } = await supabase.from("jobs").select("*").order("created_at", { ascending: false });
  logErr("listJobs", error);
  return (data as Job[]) ?? [];
}

export async function getJob(id: number): Promise<Job | undefined> {
  const { data, error } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
  logErr("getJob", error);
  return (data as Job) ?? undefined;
}

export async function getAssetsByIds(ids: number[]): Promise<Asset[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("assets").select("*").in("id", ids);
  logErr("getAssetsByIds", error);
  // preserve the requested order
  const byId = new Map((data as Asset[] | null)?.map((a) => [a.id, a]) ?? []);
  return ids.map((id) => byId.get(id)).filter((a): a is Asset => !!a);
}

export async function getLatestBrief(jobId: number): Promise<Brief | undefined> {
  const { data, error } = await supabase
    .from("briefs")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  logErr("getLatestBrief", error);
  return (data as Brief) ?? undefined;
}

export async function listRenders(jobId: number): Promise<Render[]> {
  const { data, error } = await supabase.from("renders").select("*").eq("job_id", jobId).order("shot_index");
  logErr("listRenders", error);
  return (data as Render[]) ?? [];
}

// ── helpers ──

// Stored paths are full public URLs; return as-is (kept for call-site compat).
export function assetWebPath(path: string): string {
  return publicUrl(path);
}

export { resolveDocUrl };

export function jobPlatformKeys(job: Job): string[] {
  try {
    const v = JSON.parse(job.platforms || "[]");
    if (Array.isArray(v) && v.length) return v.map(String);
  } catch {
    /* fall through */
  }
  return job.platform ? [job.platform] : ["gmb_square"];
}

// Re-export the client for ad-hoc writes in actions/routes.
export { supabase };
