// fal.ai generation. Stills (FLUX) use the synchronous REST endpoint so a static
// render completes on submit (no poll). Video (image-to-video) uses the fal
// QUEUE via the official SDK — submit returns a request id, poll fetches the
// result — because video takes minutes.
// Auth: FAL_KEY = "<id>:<secret>".

import { fal } from "@fal-ai/client";

const FAL_BASE = "https://fal.run";
// One-line model swap. flux/dev = higher quality; flux/schnell = faster/cheaper.
const FAL_IMAGE_MODEL = process.env.FAL_IMAGE_MODEL || "fal-ai/flux/dev";
// Image editing / multi-image compositing (the "fix & optimize my photos" engine).
const FAL_EDIT_MODEL = process.env.FAL_EDIT_MODEL || "fal-ai/flux-pro/kontext/max/multi";

export interface FalImage {
  url: string;
  width?: number;
  height?: number;
  seed?: number;
  model: string;
}

function authHeaders(): Record<string, string> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set in .env.local");
  return { Authorization: `Key ${key}`, "Content-Type": "application/json" };
}

async function falRun(model: string, body: Record<string, unknown>): Promise<FalImage> {
  const res = await fetch(`${FAL_BASE}/${model}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    images?: Array<{ url?: string; width?: number; height?: number }>;
    seed?: number;
    detail?: unknown;
    error?: unknown;
  };
  if (!res.ok) {
    const msg = data.detail || data.error ? JSON.stringify(data).slice(0, 300) : `HTTP ${res.status}`;
    throw new Error(`fal.ai ${res.status}: ${msg}`);
  }
  const img = data.images?.[0];
  if (!img?.url) throw new Error("fal.ai returned no image");
  return { url: img.url, width: img.width, height: img.height, seed: data.seed, model };
}

// Text-to-image (FLUX). `falImageSize` is a fal preset (square_hd, portrait_4_3, …).
export async function generateImage(prompt: string, falImageSize: string): Promise<FalImage> {
  return falRun(FAL_IMAGE_MODEL, { prompt, image_size: falImageSize, num_images: 1 });
}

// Image editing / multi-image compositing (FLUX Kontext). Pass 1 image_url to
// fix a single photo, or several to combine them. `falAspect` is a Kontext enum
// (1:1, 4:3, 3:4, 16:9, 9:16, …).
export async function editImage(
  prompt: string,
  imageUrls: string[],
  falAspect: string,
): Promise<FalImage> {
  return falRun(FAL_EDIT_MODEL, { prompt, image_urls: imageUrls, aspect_ratio: falAspect, num_images: 1 });
}

// ── video (image-to-video) via the fal queue ─────────────────────────

// One-line model swap. Kling 1.6 standard ≈ $0.056/sec, ~6 min/clip.
// Cheaper/faster alternatives exist (e.g. fal-ai/ltx-video-13b-distilled/image-to-video).
const FAL_VIDEO_MODEL =
  process.env.FAL_VIDEO_MODEL || "fal-ai/kling-video/v1.6/standard/image-to-video";

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set in .env.local");
  fal.config({ credentials: key });
  configured = true;
}

// Upload a local image buffer to fal storage; returns a fal-hosted URL the
// video model can fetch (no tunnel needed for localhost).
export async function uploadImageToFal(buf: Buffer, contentType = "image/jpeg"): Promise<string> {
  ensureConfigured();
  return fal.storage.upload(new Blob([new Uint8Array(buf)], { type: contentType }));
}

export interface VideoSubmission {
  requestId: string;
  model: string;
}
// Same shape, clearer name for non-video queue jobs (music, lip-sync, veo3…).
export type QueueSubmission = VideoSubmission;

/**
 * Generic fal QUEUE submitter. Any queued model (Kling, Veo 3, lip-sync, music)
 * enqueues through here; the caller owns the model-specific input body. Returns
 * the request id + model so the poll path can re-address the queue.
 */
export async function enqueueModel(
  model: string,
  input: Record<string, unknown>,
): Promise<QueueSubmission> {
  ensureConfigured();
  const res = await fal.queue.submit(model, { input });
  return { requestId: res.request_id, model };
}

export async function enqueueVideo(
  prompt: string,
  imageUrl: string,
  durationSeconds = 5,
  negativePrompt = "",
): Promise<VideoSubmission> {
  // Kling supports "5" | "10"; the seed image's aspect drives the clip aspect.
  const duration = durationSeconds >= 10 ? "10" : "5";
  return enqueueModel(FAL_VIDEO_MODEL, {
    prompt,
    image_url: imageUrl,
    duration,
    ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
  });
}

export type RenderStatus = "queued" | "processing" | "completed" | "failed";

export async function videoStatus(model: string, requestId: string): Promise<RenderStatus> {
  ensureConfigured();
  const s = await fal.queue.status(model, { requestId });
  switch (s.status) {
    case "COMPLETED":
      return "completed";
    case "IN_PROGRESS":
      return "processing";
    case "IN_QUEUE":
      return "queued";
    default:
      return "processing";
  }
}

export interface QueueResult {
  video?: string;
  audio?: string;
  images?: string[];
  raw: unknown;
}

/**
 * Model-agnostic queue result. fal returns different envelopes per model kind:
 * video models (Kling, Veo 3, lip-sync) → data.video.url; audio models (music,
 * TTS) → data.audio.url (or audio_file.url / audio_url); image models → data.images[].
 */
export async function queueResult(model: string, requestId: string): Promise<QueueResult> {
  ensureConfigured();
  const r = await fal.queue.result(model, { requestId });
  const d = (r.data ?? {}) as {
    video?: { url?: string };
    audio?: { url?: string };
    audio_file?: { url?: string };
    audio_url?: string;
    images?: Array<{ url?: string }>;
  };
  const audio = d.audio?.url ?? d.audio_file?.url ?? d.audio_url;
  const images = Array.isArray(d.images)
    ? d.images.map((i) => i?.url).filter((u): u is string => Boolean(u))
    : undefined;
  return { video: d.video?.url, audio, images, raw: r.data };
}

// Unchanged signature/behavior for the Kling poll path — delegates to queueResult.
export async function videoResultUrl(model: string, requestId: string): Promise<string | null> {
  return (await queueResult(model, requestId)).video ?? null;
}
