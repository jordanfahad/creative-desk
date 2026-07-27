// Speech → timed caption phrases, for "Studio Finish": real footage the clinic
// filmed on a phone, finished with burned-in captions that track what's actually
// said. Uses OpenAI transcription with segment timestamps.

import OpenAI from "openai";

export interface CaptionCue {
  start: number; // seconds
  end: number;
  text: string;
}

const MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";

/**
 * Transcribe an audio/video file to timed cues. `file` is the raw media bytes.
 * Returns [] when there's no speech — the caller then just brands the footage.
 */
export async function transcribeCues(file: Buffer, filename = "clip.mp4"): Promise<CaptionCue[]> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set in .env.local");
  const client = new OpenAI();
  const res = (await client.audio.transcriptions.create({
    file: new File([new Uint8Array(file)], filename),
    model: MODEL,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  })) as unknown as {
    segments?: Array<{ start: number; end: number; text: string }>;
    text?: string;
  };

  const segs = res.segments ?? [];
  if (!segs.length) return [];
  return dropHallucinations(
    segs
      .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: (s.text ?? "").trim() }))
      .filter((c) => c.text && c.end > c.start),
  );
}

// Speech models invent stock phrases on silent / music-only audio — most
// notoriously "Thanks for watching!" and subscribe pleas, lifted from their
// training data. Burning those onto a clinic's real footage would put words on
// screen that nobody said, so they are dropped outright.
const HALLUCINATIONS = [
  /^thanks? (you )?for watching/i,
  /^thank you( very much)?[.!]?$/i,
  /subscribe/i,
  /^please like and/i,
  /^\[?\s*(music|applause|silence|blank_audio|no speech)\s*\]?[.!]?$/i,
  /^(bye|okay|ok|you|so|hmm|uh|um)[.!]?$/i,
  /amara\.org|transcription by|subtitles by/i,
];

export function dropHallucinations(cues: CaptionCue[]): CaptionCue[] {
  const kept = cues.filter((c) => !HALLUCINATIONS.some((re) => re.test(c.text.trim())));
  // A single stock line covering (nearly) the whole clip is the classic
  // no-speech signature — safer to show no captions than invented ones.
  if (kept.length === 1) {
    const span = kept[0].end - kept[0].start;
    const words = kept[0].text.split(/\s+/).length;
    if (words <= 4 && span > 8) return [];
  }
  return kept;
}

/**
 * Split long segments into short, punchy on-screen phrases (the "TikTok caption"
 * feel) — a full sentence held for 6s reads as a wall of text; 3-5 words at a
 * time tracks the voice. Timing is split proportionally by word count.
 */
const MAX_CUE_SECONDS = 4; // a line that sits longer than this reads as static

export function toPhrases(cues: CaptionCue[], maxWords = 5): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const c of cues) {
    const words = c.text.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) {
      // Don't let a short line hang on screen for the whole clip.
      out.push({ ...c, end: Math.min(c.end, c.start + MAX_CUE_SECONDS) });
      continue;
    }
    const chunks: string[][] = [];
    for (let i = 0; i < words.length; i += maxWords) chunks.push(words.slice(i, i + maxWords));
    const dur = c.end - c.start;
    let t = c.start;
    for (const ch of chunks) {
      const share = (ch.length / words.length) * dur;
      out.push({ start: t, end: Math.min(c.end, t + share), text: ch.join(" ") });
      t += share;
    }
  }
  return out;
}
