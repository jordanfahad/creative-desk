// AI voiceover. Kept in its own module (not lib/fal.ts) because it's a DIRECT
// OpenAI call, not a fal queue job — and so the whole VO layer can be swapped to
// ElevenLabs later behind this same signature without touching callers.

import OpenAI from "openai";

// gpt-4o-mini-tts is the current quality/price sweet spot and is multilingual
// (Arabic included). tts-1 / tts-1-hd also work — swap via env.
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const DEFAULT_VOICE = process.env.OPENAI_TTS_VOICE || "alloy";

// OpenAI's supported voice set. Anything else falls back to the default so a bad
// value never fails a render.
export const TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

export function normalizeVoice(voice: string | null | undefined): string {
  return voice && (TTS_VOICES as readonly string[]).includes(voice) ? voice : DEFAULT_VOICE;
}

type TtsFormat = "mp3" | "wav" | "opus" | "aac" | "flac" | "pcm";

// The TTS input cap is ~4096 chars; split long scripts on sentence boundaries so
// a whole paragraph still voices cleanly (buffers are concatenated by the caller
// per shot, so a single call is usually one short line).
const MAX_CHARS = 3800;

function chunkText(text: string): string[] {
  const clean = text.trim();
  if (clean.length <= MAX_CHARS) return [clean];
  const out: string[] = [];
  let buf = "";
  for (const sentence of clean.split(/(?<=[.!?؟。])\s+/)) {
    if ((buf + " " + sentence).trim().length > MAX_CHARS) {
      if (buf) out.push(buf.trim());
      buf = sentence;
    } else {
      buf = (buf ? buf + " " : "") + sentence;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Synthesize a spoken line to an audio buffer. `voice` is validated; unknown
 * values fall back to the default. Long text is chunked and concatenated (mp3
 * frames concatenate cleanly for playback). `instructions` (gpt-4o-mini-tts
 * only) can steer accent/tone, e.g. "warm, calm, professional".
 */
export async function synthVoice(
  text: string,
  voice?: string,
  format: TtsFormat = "mp3",
  instructions?: string,
): Promise<Buffer> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set in .env.local");
  const clean = (text ?? "").trim();
  if (!clean) throw new Error("synthVoice: empty text");
  const client = new OpenAI();
  const v = normalizeVoice(voice);

  const parts = chunkText(clean);
  const buffers: Buffer[] = [];
  for (const part of parts) {
    const res = await client.audio.speech.create({
      model: TTS_MODEL,
      voice: v,
      input: part,
      response_format: format,
      ...(instructions && TTS_MODEL.startsWith("gpt-4o") ? { instructions } : {}),
    });
    buffers.push(Buffer.from(await res.arrayBuffer()));
  }
  return buffers.length === 1 ? buffers[0] : Buffer.concat(buffers);
}
