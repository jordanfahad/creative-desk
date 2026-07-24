// Central registry of the fal QUEUE models Creative Desk can drive, plus how to
// build each one's input body and what kind of result it returns. Everything is
// env-overridable so model ids / cost / quality can be tuned without a deploy.
//
// The poll path is model-agnostic (it re-addresses the queue by the model id
// stashed on the render row) EXCEPT it needs to know whether a completed job
// yields a video or an audio url. That hint travels in renders.meta.result_kind
// (default "video"), so no DB column is needed and every existing Kling row
// keeps the video path.

export type ResultKind = "video" | "audio" | "image";

export interface ModelSpec {
  id: string;
  result: ResultKind;
}

/**
 * Logical purpose → fal model. Keep the Kling body inside enqueueVideo (lib/fal.ts)
 * so its behavior can never drift; the specs here drive the NEW paths.
 */
export const MODELS = {
  // Image-to-video, silent — the current default clip engine.
  kling: {
    id: process.env.FAL_VIDEO_MODEL || "fal-ai/kling-video/v1.6/standard/image-to-video",
    result: "video",
  },
  // Image-to-video WITH native dialogue/lip-sync + audio (premium ~$0.40/s).
  veo3: {
    id: process.env.FAL_VEO3_MODEL || "fal-ai/veo3.1/image-to-video",
    result: "video",
  },
  // Drive an existing video/still from an audio track (cheap lip-sync).
  lipsync: {
    id: process.env.FAL_LIPSYNC_MODEL || "fal-ai/sync-lipsync/v2",
    result: "video",
  },
  // Text→music bed (optional upgrade over the synthesized sine beds).
  music: {
    id: process.env.FAL_MUSIC_MODEL || "fal-ai/minimax-music",
    result: "audio",
  },
} satisfies Record<string, ModelSpec>;

export type ModelKey = keyof typeof MODELS;

export function modelSpec(key: ModelKey): ModelSpec {
  return MODELS[key];
}

// ── per-model input builders ────────────────────────────────────────────────
// Each returns the `input` object for enqueueModel(spec.id, input). Kept here so
// the model-specific body shapes live next to the ids they belong to.

/**
 * Veo 3.1 image-to-video with a spoken line. `dialogue` is baked into the mp4
 * (no separate audio track). Duration is model-controlled; aspect follows the
 * seed image unless overridden.
 */
export function veo3Input(opts: {
  imageUrl: string;
  prompt: string;
  dialogue?: string;
  aspectRatio?: string;
  generateAudio?: boolean;
}): Record<string, unknown> {
  const { imageUrl, prompt, dialogue, aspectRatio, generateAudio = true } = opts;
  const full = dialogue ? `${prompt}\n\nThe person says: "${dialogue}"` : prompt;
  return {
    image_url: imageUrl,
    prompt: full,
    generate_audio: generateAudio,
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
  };
}

/**
 * Lip-sync: drive a base video/still with an audio track. Both must be public
 * URLs (upload the TTS mp3 via uploadImageToFal first).
 */
export function lipsyncInput(opts: { videoUrl: string; audioUrl: string }): Record<string, unknown> {
  return { video_url: opts.videoUrl, audio_url: opts.audioUrl };
}

/**
 * Text→music. `seconds_total` is honored by stable-audio-style models; minimax
 * ignores it harmlessly. Feed the resulting audio url straight into
 * muxMusicIntoVideo(video, out, url) — it already accepts an http(s) choice.
 */
export function musicInput(opts: { prompt: string; seconds?: number }): Record<string, unknown> {
  return {
    prompt: opts.prompt,
    ...(opts.seconds ? { seconds_total: Math.round(opts.seconds) } : {}),
  };
}
