import { supabase } from "./supabase";
import { publicUrl, resolveDocUrl } from "./storage";

// Supabase-backed data layer. All reads/writes are async via the admin client.
// (Schema lives in Supabase; see db/schema.sql for the equivalent DDL.)

export interface BrandKit {
  id: number;
  project_id: number;
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
  project_id: number;
  title: string;
  body: string;
  source: string;
  doc_path: string | null;
  active: number;
  created_at: string;
}

export interface Logo {
  id: number;
  project_id: number;
  label: string;
  path: string;
  is_default: number;
  created_at: string;
}

export interface Asset {
  id: number;
  project_id: number;
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
  project_id: number;
  title: string;
  mode: "static" | "dynamic";
  goal: string | null;
  brief_notes: string | null;
  brief_doc_path: string | null;
  brief_doc_text: string | null;
  intent: "optimize" | "create";
  media: "image" | "video";
  platforms: string;
  video_mode: "passthrough" | "ai_enhance" | "animate" | "generate" | "montage";
  /** Funnel stage steering the AI brief: awareness | consideration | conversion | null. */
    funnel_goal: string | null;
  /** Custom closing-card call-to-action (e.g. "WhatsApp us — 04 123 4567"); null = goal-based default. */
  cta_text: string | null;
  /** Optional second line under the CTA; null = brand tagline. */
  cta_subtext: string | null;
  /** Montage soundtrack: preset key (calm|warm|uplift), a storage path for an uploaded track, or null. */
  music_track: string | null;
  image_mode: "text" | "edit" | "generate";
  style: string;
  /** Carousel slides to generate for a create job: 1 (single) … 6. */
  carousel_count: number;
  combine: number;
  platform: string;
  logo_enabled: number;
  logo_position: string;
  logo_id: number | null;
  asset_ids: string;
  inspiration_ids: string;
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

export async function getBrandKit(projectId: number): Promise<BrandKit | undefined> {
  const { data, error } = await supabase.from("brand_kit").select("*").eq("project_id", projectId).maybeSingle();
  logErr("getBrandKit", error);
  return (data as BrandKit) ?? undefined;
}

export async function listGuidelines(projectId: number): Promise<Guideline[]> {
  const { data, error } = await supabase.from("guidelines").select("*").eq("project_id", projectId).order("created_at");
  logErr("listGuidelines", error);
  return (data as Guideline[]) ?? [];
}

export async function listLogos(projectId: number): Promise<Logo[]> {
  const { data, error } = await supabase
    .from("cd_logos")
    .select("*")
    .eq("project_id", projectId)
    .order("is_default", { ascending: false })
    .order("created_at");
  logErr("listLogos", error);
  return (data as Logo[]) ?? [];
}

export async function getLogo(id: number): Promise<Logo | undefined> {
  const { data } = await supabase.from("cd_logos").select("*").eq("id", id).maybeSingle();
  return (data as Logo) ?? undefined;
}

export async function getDefaultLogo(projectId: number): Promise<Logo | undefined> {
  const { data } = await supabase
    .from("cd_logos")
    .select("*")
    .eq("project_id", projectId)
    .eq("is_default", 1)
    .maybeSingle();
  return (data as Logo) ?? undefined;
}

export async function listAssets(projectId: number): Promise<Asset[]> {
  const { data, error } = await supabase.from("assets").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  logErr("listAssets", error);
  return (data as Asset[]) ?? [];
}

export async function listJobs(projectId: number): Promise<Job[]> {
  const { data, error } = await supabase.from("jobs").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
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

/** Parsed jobs.inspiration_ids — style-reference asset ids ("make it like this"). */
export function jobInspirationIds(job: Pick<Job, "inspiration_ids">): number[] {
  try {
    const v = JSON.parse(job.inspiration_ids || "[]");
    if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
  } catch {
    /* fall through */
  }
  return [];
}

// A job renders as a photo montage (many photos → ONE Ken-Burns video) only
// when it's a single-output video montage. Choosing a carousel (2+ slides) means
// separate items, so it is NOT a montage — it routes to the multi-clip path.
export function isMontageJob(job: Pick<Job, "media" | "video_mode" | "carousel_count">): boolean {
  return job.media === "video" && job.video_mode === "montage" && (job.carousel_count ?? 1) < 2;
}

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
