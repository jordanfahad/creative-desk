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

export async function enqueueVideo(
  prompt: string,
  imageUrl: string,
  durationSeconds = 5,
  negativePrompt = "",
): Promise<VideoSubmission> {
  ensureConfigured();
  // Kling supports "5" | "10"; the seed image's aspect drives the clip aspect.
  const duration = durationSeconds >= 10 ? "10" : "5";
  const res = await fal.queue.submit(FAL_VIDEO_MODEL, {
    input: {
      prompt,
      image_url: imageUrl,
      duration,
      ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
    },
  });
  return { requestId: res.request_id, model: FAL_VIDEO_MODEL };
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

export async function videoResultUrl(model: string, requestId: string): Promise<string | null> {
  ensureConfigured();
  const r = await fal.queue.result(model, { requestId });
  const data = r.data as { video?: { url?: string } };
  return data.video?.url ?? null;
}
