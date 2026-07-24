import { spawn } from "node:child_process";
import { join } from "node:path";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import ffmpegStatic from "ffmpeg-static";
import { loadLogoBuffer } from "./finish";
import { FONT_SANS_BOLD_B64 } from "./fonts";

// Photo-montage rendering: N still photos → one clean brand video. Each photo
// is letterboxed WHOLE and held STATIC, with a smooth crossfade dissolve to the
// next (plus a global fade in/out and an optional brand end-card). No per-image
// zoom/pan — a slow zoom on a finished, text-bearing post stair-steps into a
// visible "vibration", and motion isn't right for designed graphics anyway.
// Deterministic ffmpeg — no AI render credits. The master is SQUARE (like the
// image pipeline) so finishVideo() can cover-crop it to every channel ratio.
// FFMPEG_PATH overrides the bundled binary (local dev/test).

const FFMPEG = process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string);

// Master canvas. Square crops acceptably to both 9:16 and 16:9, mirroring
// MASTER_ASPECT for images. Sources are pre-scaled 1.5× for zoom headroom.
const MASTER = 1440;
const SRC = 2160;
const FPS = 30;
/** Crossfade dissolve between shots (seconds), capped to half the shortest hold. */
const XFADE = 0.6;
/** Fraction of the frame the artwork occupies (the rest is a soft matte). */
const SAFE = 0.92;

export const MONTAGE_MOTIONS = ["zoom-in", "zoom-out", "pan-left", "pan-right"] as const;
export type MontageMotion = (typeof MONTAGE_MOTIONS)[number];

/** Normalize a brief's free-text motion to a supported move (default zoom-in). */
export function normalizeMotion(raw: string | null | undefined, index: number): MontageMotion {
  const t = (raw ?? "").toLowerCase();
  for (const m of MONTAGE_MOTIONS) if (t.includes(m)) return m;
  if (t.includes("out")) return "zoom-out";
  if (t.includes("left")) return "pan-left";
  if (t.includes("right")) return "pan-right";
  // vary by position so an un-curated montage still feels alive
  return MONTAGE_MOTIONS[index % MONTAGE_MOTIONS.length];
}

export interface MontageShot {
  /** Public URL (or local path) of the photo. */
  imageUrl: string;
  /** Seconds this photo holds on screen. */
  holdSeconds: number;
  motion: MontageMotion;
}

export interface MontageOpts {
  /** Optional closing card: a call-to-action headline + logo on a brand field. */
  endCard?: { logoUrl: string; bgColor?: string; holdSeconds?: number; cta?: string; subtext?: string } | null;
  /**
   * Optional soundtrack baked into the export (paid ads can't use the platform's
   * in-app music, so it has to be in the file). Either a built-in preset key
   * ("calm" | "warm" | "uplift"), synthesized on the fly (royalty-free by
   * construction), or an http(s) URL to the user's own uploaded track. Null =
   * silent. Whatever is chosen is looped/trimmed to the video length with a
   * gentle fade in/out.
   */
  music?: string | null;
}

/** Built-in beds — a soft chord PAD plus a rhythmic PLUCK, synthesized by ffmpeg
 *  (no files, no licensing). The pluck + a musical pulse give it rhythm so it
 *  reads as light background music, not a sustained requiem drone. No big reverb
 *  tail (that's what made the old beds sound funereal). */
interface Pad {
  chord: { hz: number; gain: number }[];
  pluckHz: number; // rhythmic pluck note
  pluckGain: number;
  pulseHz: number; // pluck rate (Hz): ~2 ≈ 120 "bpm" feel
  padPulse: number; // gentle pad swell depth (0..1)
  lowpass: number;
  volume: number;
}
const MUSIC_PRESETS: Record<string, Pad> = {
  // Warm major (C) — reassuring, premium, gentle pulse.
  warm: {
    chord: [
      { hz: 130.81, gain: 0.34 }, // C3
      { hz: 196.0, gain: 0.26 }, // G3
      { hz: 261.63, gain: 0.24 }, // C4
      { hz: 329.63, gain: 0.22 }, // E4
    ],
    pluckHz: 523.25, // C5
    pluckGain: 0.3,
    pulseHz: 1.95,
    padPulse: 0.18,
    lowpass: 3400,
    volume: 1.7,
  },
  // Calm (A minor 7, soft) — still and trustworthy but not dirge-y.
  calm: {
    chord: [
      { hz: 146.83, gain: 0.32 }, // D3
      { hz: 220.0, gain: 0.24 }, // A3
      { hz: 261.63, gain: 0.22 }, // C4
      { hz: 349.23, gain: 0.2 }, // F4
    ],
    pluckHz: 440.0, // A4
    pluckGain: 0.24,
    pulseHz: 1.6,
    padPulse: 0.14,
    lowpass: 2900,
    volume: 1.6,
  },
  // Uplift major (C, brighter, more movement).
  uplift: {
    chord: [
      { hz: 130.81, gain: 0.3 },
      { hz: 261.63, gain: 0.24 },
      { hz: 329.63, gain: 0.22 },
      { hz: 392.0, gain: 0.22 }, // G4
    ],
    pluckHz: 659.25, // E5
    pluckGain: 0.32,
    pulseHz: 2.25,
    padPulse: 0.2,
    lowpass: 3900,
    volume: 1.8,
  },
  // Upbeat (G major, higher, faster pulse) — energetic, good for conversion ads.
  upbeat: {
    chord: [
      { hz: 196.0, gain: 0.3 }, // G3
      { hz: 293.66, gain: 0.24 }, // D4
      { hz: 392.0, gain: 0.22 }, // G4
      { hz: 493.88, gain: 0.2 }, // B4
    ],
    pluckHz: 783.99, // G5
    pluckGain: 0.34,
    pulseHz: 2.5,
    padPulse: 0.22,
    lowpass: 4300,
    volume: 1.9,
  },
};
export const MUSIC_PRESET_KEYS = Object.keys(MUSIC_PRESETS);

/** Fetch a user's uploaded track (bounded) so it can be looped into the mux. */
async function fetchAudio(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`music fetch failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Produce an audio file EXACTLY `seconds` long (faded in/out) for the mux —
 * either a synthesized preset bed or the user's looped/trimmed track. Returns
 * null (→ silent) on any failure, so audio never sinks the render.
 */
async function prepareMusicTrack(dir: string, choice: string, seconds: number): Promise<string | null> {
  const out = join(dir, "music.m4a");
  const dur = Math.max(1, seconds);
  const fadeOut = Math.max(0, dur - 1.5);
  try {
    const pad = MUSIC_PRESETS[choice];
    if (pad) {
      const notes = pad.chord;
      const inputs: string[] = [];
      for (const f of notes) inputs.push("-f", "lavfi", "-i", `sine=frequency=${f.hz}:duration=${dur.toFixed(2)}`);
      inputs.push("-f", "lavfi", "-i", `sine=frequency=${pad.pluckHz}:duration=${dur.toFixed(2)}`);
      const pluckIdx = notes.length;
      const chains = notes.map((f, i) => `[${i}]volume=${f.gain}[a${i}]`);
      // pluck: a rhythmic on/off (deep tremolo) high note, low end trimmed → reads as music, not drone
      chains.push(`[${pluckIdx}]volume=${pad.pluckGain},highpass=f=320,tremolo=f=${pad.pulseHz}:d=0.9[apl]`);
      const mixLabels = notes.map((_, i) => `[a${i}]`).join("") + "[apl]";
      const filter =
        `${chains.join(";")};${mixLabels}amix=inputs=${notes.length + 1}:normalize=0,` +
        `tremolo=f=${(pad.pulseHz / 2).toFixed(3)}:d=${pad.padPulse},` + // gentle half-time pad swell
        `lowpass=f=${pad.lowpass},volume=${pad.volume},alimiter=limit=0.95,` +
        `afade=t=in:d=1.2,afade=t=out:st=${fadeOut.toFixed(2)}:d=1.5[a]`;
      await runFfmpeg(["-y", ...inputs, "-filter_complex", filter, "-map", "[a]", "-c:a", "aac", "-b:a", "160k", out]);
      return out;
    }
    if (/^https?:\/\//.test(choice)) {
      const srcp = join(dir, "music-src");
      await writeFile(srcp, await fetchAudio(choice));
      await runFfmpeg([
        "-y", "-stream_loop", "-1", "-i", srcp, "-t", dur.toFixed(2),
        "-af", `afade=t=in:d=1,afade=t=out:st=${fadeOut.toFixed(2)}:d=1.5,alimiter=limit=0.95`,
        "-c:a", "aac", "-b:a", "160k", out,
      ]);
      return out;
    }
  } catch {
    return null; // silent is better than a broken render
  }
  return null;
}

/**
 * Fit a photo WHOLE onto the square master (never crop it). The artwork is
 * scaled to sit inside a safe box and centered over a soft, dimmed, blurred
 * copy of itself — so a portrait / 4:5 / already-composed post keeps every
 * pixel (text card, logo, faces) instead of being cover-cropped to a square,
 * and the letterbox reads as an intentional matte rather than flat bars.
 */
async function letterboxSquare(buf: Buffer): Promise<Buffer> {
  const bg = await sharp(buf)
    .rotate()
    .resize(SRC, SRC, { fit: "cover", position: "centre" })
    .blur(40)
    .modulate({ brightness: 0.8 })
    .toBuffer();
  const box = Math.round(SRC * SAFE);
  const fg = await sharp(buf)
    .rotate()
    .resize(box, box, { fit: "inside", withoutEnlargement: false })
    .toBuffer();
  const meta = await sharp(fg).metadata();
  const fw = meta.width ?? box;
  const fh = meta.height ?? box;
  return sharp(bg)
    .composite([{ input: fg, left: Math.round((SRC - fw) / 2), top: Math.round((SRC - fh) / 2) }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function fetchImage(url: string): Promise<Buffer> {
  if (!/^https?:\/\//.test(url)) return readFile(url);
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`image fetch failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Wrap text to at most `maxLines` lines of ≤ `perLine` chars (greedy by word).
function wrapLines(text: string, perLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= perLine) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines[maxLines - 1] = lines.slice(maxLines - 1).join(" ");
    lines.length = maxLines;
  }
  return lines;
}

/**
 * Compose the closing card: a brand-color field with a CALL-TO-ACTION headline
 * (+ optional subtext) above the logo — the ad's payoff, not dead air. Text is
 * drawn with an embedded font so it renders identically on Vercel.
 */
async function buildEndCard(logoUrl: string, bgColor: string, cta?: string, subtext?: string): Promise<Buffer> {
  const logo = await loadLogoBuffer(logoUrl);
  const hasText = !!(cta && cta.trim());
  const logoW = Math.round(SRC * (hasText ? 0.34 : 0.42));
  const scaled = await sharp(logo).resize({ width: logoW }).png().toBuffer();
  const meta = await sharp(scaled).metadata();
  const lw = meta.width ?? logoW;
  const lh = meta.height ?? Math.round(logoW * 0.4);

  const parts: string[] = [`<rect width="100%" height="100%" fill="${bgColor}"/>`];
  let logoTop = Math.round((SRC - lh) / 2); // centered when there's no text
  if (hasText) {
    const lines = wrapLines(cta!.trim(), 17, 2);
    const fs = lines.length > 1 ? 200 : 232;
    const lineH = Math.round(fs * 1.08);
    const blockTop = Math.round(SRC * 0.3);
    const tspans = lines
      .map((ln, i) => `<tspan x="50%" dy="${i === 0 ? 0 : lineH}">${xmlEsc(ln)}</tspan>`)
      .join("");
    parts.push(
      `<text x="50%" y="${blockTop}" text-anchor="middle" font-family="CDSans" font-weight="700" font-size="${fs}" fill="#ffffff">${tspans}</text>`,
    );
    let y = blockTop + (lines.length - 1) * lineH;
    if (subtext && subtext.trim()) {
      const sub = wrapLines(subtext.trim(), 34, 2);
      const sfs = 92;
      const slh = Math.round(sfs * 1.12);
      const subTspans = sub
        .map((ln, i) => `<tspan x="50%" dy="${i === 0 ? 0 : slh}">${xmlEsc(ln)}</tspan>`)
        .join("");
      y += Math.round(fs * 0.9);
      parts.push(
        `<text x="50%" y="${y}" text-anchor="middle" font-family="CDSans" font-weight="700" font-size="${sfs}" fill="#cfe2d0">${subTspans}</text>`,
      );
      y += (sub.length - 1) * slh;
    }
    logoTop = Math.min(y + Math.round(SRC * 0.14), SRC - lh - Math.round(SRC * 0.06));
  }

  const svg = `<svg width="${SRC}" height="${SRC}" xmlns="http://www.w3.org/2000/svg"><defs><style>@font-face{font-family:'CDSans';src:url(data:font/ttf;base64,${FONT_SANS_BOLD_B64}) format('truetype');}</style></defs>${parts.join("")}</svg>`;

  return sharp(Buffer.from(svg))
    .composite([{ input: scaled, left: Math.round((SRC - lw) / 2), top: logoTop }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    if (!FFMPEG) return rej(new Error("ffmpeg binary not found (ffmpeg-static)"));
    const proc = spawn(FFMPEG, args);
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", rej);
    proc.on("close", (code) =>
      code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}: ${err.slice(-600)}`)),
    );
  });
}

/**
 * Render the montage master (square MP4). Optionally bakes in a soundtrack
 * (built-in bed or the user's own track). Returns the MP4 buffer.
 */
export async function buildMontageMaster(shots: MontageShot[], opts: MontageOpts = {}): Promise<Buffer> {
  if (!shots.length) throw new Error("montage needs at least one photo");
  const dir = join(tmpdir(), `cd-montage-${randomUUID().slice(0, 8)}`);
  await mkdir(dir, { recursive: true });
  try {
    // 1 · normalize every photo (EXIF rotation, letterbox WHOLE to the square).
    // One bad/unreachable photo skips that shot instead of sinking the montage.
    const frames: { path: string; holdSeconds: number; motion: MontageMotion }[] = [];
    for (let i = 0; i < shots.length; i++) {
      try {
        const buf = await fetchImage(shots[i].imageUrl);
        // Letterbox WHOLE (never cover-crop) so composed posts keep their text.
        const jpg = await letterboxSquare(buf);
        const p = join(dir, `src-${i}.jpg`);
        await writeFile(p, jpg);
        frames.push({ path: p, holdSeconds: shots[i].holdSeconds, motion: shots[i].motion });
      } catch {
        // skip this photo
      }
    }
    if (!frames.length) throw new Error("none of the montage photos could be loaded");
    if (opts.endCard) {
      try {
        const card = await buildEndCard(opts.endCard.logoUrl, opts.endCard.bgColor || "#1F3A5F", opts.endCard.cta, opts.endCard.subtext);
        const p = join(dir, `src-end.jpg`);
        await writeFile(p, card);
        frames.push({ path: p, holdSeconds: opts.endCard.holdSeconds ?? 3.0, motion: "zoom-in" });
      } catch {
        // no end-card is better than no video
      }
    }

    // 2 · assemble in ONE ffmpeg graph: each still is held STATIC for its hold,
    // dissolving into the next with a crossfade (no zoom/pan → no vibration),
    // then a global fade in/out. Every still is scaled to the square master at a
    // fixed fps so the xfade chain lines up.
    // Floor at 2.0s so a text-bearing slide is actually readable before it dissolves.
    const holds = frames.map((f) => Math.min(Math.max(f.holdSeconds, 2.0), 6));
    const n = frames.length;
    const silentPath = join(dir, "silent.mp4");
    let videoSeconds: number;

    if (n === 1) {
      videoSeconds = holds[0];
      await runFfmpeg([
        "-y",
        "-loop", "1", "-t", holds[0].toFixed(3), "-i", frames[0].path,
        "-vf", `scale=${MASTER}:${MASTER},setsar=1,fps=${FPS},format=yuv420p,fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0, holds[0] - 0.7).toFixed(2)}:d=0.7`,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        silentPath,
      ]);
    } else {
      // Crossfade ≤ half the shortest hold, so even a short shot fully appears.
      const T = Math.min(XFADE, Math.min(...holds) * 0.5);
      const inputs: string[] = [];
      for (let i = 0; i < n; i++) {
        // give each input a little tail past its hold so the xfade always has frames
        inputs.push("-loop", "1", "-t", (holds[i] + T + 0.1).toFixed(3), "-i", frames[i].path);
      }
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        parts.push(`[${i}:v]scale=${MASTER}:${MASTER},setsar=1,fps=${FPS},format=yuv420p[v${i}]`);
      }
      // Chain xfades; each offset is where in the accumulated timeline the
      // dissolve begins (cumulative length so far minus one transition).
      let last = "v0";
      let acc = holds[0];
      for (let i = 1; i < n; i++) {
        const out = i === n - 1 ? "xf" : `x${i}`;
        parts.push(
          `[${last}][v${i}]xfade=transition=fade:duration=${T.toFixed(3)}:offset=${(acc - T).toFixed(3)}[${out}]`,
        );
        last = out;
        acc = acc + holds[i] - T;
      }
      videoSeconds = acc; // = sum(holds) - (n-1)*T
      parts.push(
        `[${last}]fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0, videoSeconds - 0.7).toFixed(2)}:d=0.7[vout]`,
      );

      await runFfmpeg([
        "-y",
        ...inputs,
        "-filter_complex", parts.join(";"),
        "-map", "[vout]",
        // Pin the duration to the computed timeline: the xfade graph leaves a
        // short post-fade tail from the last input's padding; trimming to
        // videoSeconds drops that trailing (already faded-out) bit AND makes the
        // length deterministic so a music bed can be built to match exactly.
        "-t", videoSeconds.toFixed(3),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        silentPath,
      ]);
    }

    // 3 · optional soundtrack. Build an audio bed exactly the video's length and
    // mux it in (video is stream-copied — no re-encode). Any music failure falls
    // back to the silent master, so audio can never sink the render.
    if (opts.music) {
      const audio = await prepareMusicTrack(dir, opts.music, videoSeconds);
      if (audio) {
        const outPath = join(dir, "master.mp4");
        await runFfmpeg([
          "-y",
          "-i", silentPath,
          "-i", audio,
          "-map", "0:v", "-map", "1:a",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
          "-shortest", "-movflags", "+faststart",
          outPath,
        ]);
        return await readFile(outPath);
      }
    }
    return await readFile(silentPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}