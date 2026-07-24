import { spawn } from "node:child_process";
import { join } from "node:path";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import ffmpegStatic from "ffmpeg-static";
import { parse as parseFont, type Font } from "opentype.js";
import { ArabicShaper } from "arabic-persian-reshaper";
import { loadLogoBuffer } from "./finish";
import { FONT_SANS_BOLD_B64 } from "./fonts";
import { FONT_ARABIC_B64 } from "./fontsArabic";

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
  /** Optional closing card: a call-to-action headline (+ logo, if any) on a brand field. */
  endCard?: { logoUrl?: string | null; bgColor?: string; holdSeconds?: number; cta?: string; subtext?: string } | null;
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

// Text is drawn as VECTOR PATHS (opentype.js) so it renders identically on
// Vercel — librsvg there ignores @font-face data-URIs, so any font-based SVG
// text comes out as tofu. Paths need no font at render time.
let _endFont: Font | null = null;
function endFont(): Font {
  if (_endFont) return _endFont;
  const b = Buffer.from(FONT_SANS_BOLD_B64, "base64");
  _endFont = parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return _endFont;
}
/** SVG <path> for one line centered within `canvasW`, baseline at `baselineY`. */
function linePathIn(canvasW: number, f: Font, text: string, baselineY: number, fontSize: number, fill: string): string {
  const w = f.getAdvanceWidth(text, fontSize);
  const p = f.getPath(text, (canvasW - w) / 2, baselineY, fontSize);
  p.fill = fill;
  return p.toSVG(2);
}
/** SVG <path> for one centered line on the square card canvas (SRC). */
function linePath(f: Font, text: string, baselineY: number, fontSize: number, fill: string): string {
  return linePathIn(SRC, f, text, baselineY, fontSize, fill);
}

// ── Arabic support ───────────────────────────────────────────────────
// Amiri Bold carries Arabic Presentation Forms glyphs, so text pre-shaped by
// the reshaper renders as connected Naskh WITHOUT a GSUB shaping engine —
// opentype.js's own Arabic engine crashes on Amiri's advanced tables, so we
// bypass it entirely with per-glyph layout.
let _arFont: Font | null = null;
function arFont(): Font {
  if (_arFont) return _arFont;
  const b = Buffer.from(FONT_ARABIC_B64, "base64");
  _arFont = parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return _arFont;
}

const AR_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

function shapeArabic(t: string): string {
  try {
    return ArabicShaper.convertArabic(t);
  } catch {
    return t; // unshaped beats crashed — Amiri still has the base glyphs
  }
}

// Arabic LETTERS only (deliberately excludes Arabic-Indic digits U+0660-0669
// and punctuation like ٪ — digits must stay in logical order inside RTL text).
const AR_LETTER_SPAN = /[ؠ-ٟٮ-ۓۺ-ۿﭐ-﷿ﹰ-﻿]+|[^ؠ-ٟٮ-ۓۺ-ۿﭐ-﷿ﹰ-﻿]+/g;
const AR_LETTER = /[ؠ-ٟٮ-ۓۺ-ۿﭐ-﷿ﹰ-﻿]/;

/** Display order for one token: split into script spans; Arabic-letter spans are
 *  shaped + reversed, digit/Latin spans keep their order; span order reverses.
 *  So "خصم50%" reads خصم then 50% — never "05". */
function prepToken(tok: string): string {
  const spans = tok.match(AR_LETTER_SPAN) ?? [tok];
  return spans
    .map((s) => (AR_LETTER.test(s) ? [...shapeArabic(s)].reverse().join("") : s))
    .reverse()
    .join("");
}

/** Logical → display order for an Arabic-containing line (naive bidi: reverse
 *  token order; Arabic tokens via prepToken; pure Latin/digit tokens stay LTR). */
function prepLine(t: string): string {
  if (!AR_RE.test(t)) return t;
  return t
    .split(/\s+/)
    .map((tok) => (AR_RE.test(tok) ? prepToken(tok) : tok))
    .reverse()
    .join(" ");
}

/** Width of a (display-order) line — Arabic sums per-glyph advances. */
function lineWidth(t: string, fontSize: number): number {
  if (!AR_RE.test(t)) return endFont().getAdvanceWidth(t, fontSize);
  const f = arFont();
  const s = fontSize / f.unitsPerEm;
  let w = 0;
  for (const ch of t) w += (f.charToGlyph(ch).advanceWidth ?? 600) * s;
  return w;
}

/** SVG paths for one line centered within `canvasW` (display-order), either script. */
function centeredLineIn(canvasW: number, t: string, baselineY: number, fontSize: number, fill: string): string {
  if (!AR_RE.test(t)) return linePathIn(canvasW, endFont(), t, baselineY, fontSize, fill);
  const f = arFont();
  const s = fontSize / f.unitsPerEm;
  let x = (canvasW - lineWidth(t, fontSize)) / 2;
  const parts: string[] = [];
  for (const ch of t) {
    const g = f.charToGlyph(ch);
    if (ch !== " ") {
      const p = g.getPath(x, baselineY, fontSize);
      p.fill = fill;
      parts.push(p.toSVG(2));
    }
    x += (g.advanceWidth ?? 600) * s;
  }
  return parts.join("");
}
/** SVG paths for one centered line on the square card canvas (SRC). */
function centeredLine(t: string, baselineY: number, fontSize: number, fill: string): string {
  return centeredLineIn(SRC, t, baselineY, fontSize, fill);
}

/** Lighten (f>1) or darken (f<1) a #rgb/#rrggbb hex color. */
function shadeHex(hex: string, f: number): string {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m.slice(0, 6);
  const n = parseInt(full, 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

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
 * vectorized so it renders on Vercel regardless of installed fonts. The logo is
 * optional (a custom CTA still gets its card when the corner logo is off), it
 * shrinks rather than overlapping the text, and any line that can't fit even at
 * the minimum font size is ellipsized instead of running off the card.
 */
async function buildEndCard(logoUrl: string | null, bgColor: string, cta?: string, subtext?: string): Promise<Buffer> {
  // bgColor comes from the free-text brand-colors field → validate before it
  // lands inside SVG markup.
  const safeBg = /^#[0-9a-fA-F]{3,8}$/.test(bgColor) ? bgColor : "#1F3A5F";
  const hasText = !!(cta && cta.trim());

  let scaled: Buffer | null = null;
  let lw = 0;
  let lh = 0;
  if (logoUrl) {
    try {
      const logo = await loadLogoBuffer(logoUrl);
      const logoW = Math.round(SRC * (hasText ? 0.32 : 0.42));
      scaled = await sharp(logo).resize({ width: logoW }).png().toBuffer();
      const meta = await sharp(scaled).metadata();
      lw = meta.width ?? logoW;
      lh = meta.height ?? Math.round(logoW * 0.4);
    } catch {
      scaled = null; // a broken logo shouldn't sink the CTA card
    }
  }

  const paths: string[] = [];
  let logoTop = Math.round((SRC - lh) / 2); // centered when there's no text
  if (hasText) {
    const maxW = Math.round(SRC * 0.88); // text must never run off the card
    // Ellipsize a line that can't fit even at the floored font size (e.g. one
    // long unbroken wa.me link) — trimmed beats clipped. Display-order aware:
    // Arabic lines trim from the front (their visual tail) and prefix the "…".
    const fit = (ln: string, size: number): string => {
      if (lineWidth(ln, size) <= maxW) return ln;
      const rtl = AR_RE.test(ln);
      let t = ln;
      while (t.length > 1 && lineWidth(rtl ? "…" + t : t + "…", size) > maxW) {
        t = rtl ? t.slice(1) : t.slice(0, -1);
      }
      return rtl ? "…" + t : t + "…";
    };
    // Wrap on logical text, then convert each line to display order (Arabic
    // lines are reshaped to presentation forms + reversed).
    const lines = wrapLines(cta!.trim(), 17, 2).map(prepLine);
    let fs = lines.length > 1 ? 200 : 236;
    // Fit-to-width: a long CTA (offers, phone numbers) shrinks instead of clipping.
    const widest = Math.max(...lines.map((ln) => lineWidth(ln, fs)));
    if (widest > maxW) fs = Math.max(96, Math.floor((fs * maxW) / widest));
    const fitted = lines.map((ln) => fit(ln, fs));
    const lineH = Math.round(fs * 1.14);
    const baseline = Math.round(SRC * 0.3) + fs; // first line's baseline
    fitted.forEach((ln, i) => paths.push(centeredLine(ln, baseline + i * lineH, fs, "#ffffff")));
    let y = baseline + (fitted.length - 1) * lineH;
    if (subtext && subtext.trim()) {
      const sub = wrapLines(subtext.trim(), 34, 2).map(prepLine);
      let sfs = 92;
      const subWidest = Math.max(...sub.map((ln) => lineWidth(ln, sfs)));
      if (subWidest > maxW) sfs = Math.max(52, Math.floor((sfs * maxW) / subWidest));
      const fittedSub = sub.map((ln) => fit(ln, sfs));
      const slh = Math.round(sfs * 1.18);
      y += Math.round(fs * 0.95);
      fittedSub.forEach((ln, i) => paths.push(centeredLine(ln, y + i * slh, sfs, "#cfe2d0")));
      y += (fittedSub.length - 1) * slh;
    }
    logoTop = y + Math.round(SRC * 0.14);
    // The logo must never ride up over the text: shrink it into the space left
    // below (or drop it if there's effectively none).
    if (scaled) {
      const maxLogoH = SRC - Math.round(SRC * 0.06) - logoTop;
      if (maxLogoH <= 60) {
        scaled = null;
      } else if (lh > maxLogoH) {
        scaled = await sharp(scaled).resize({ height: maxLogoH }).png().toBuffer();
        const m2 = await sharp(scaled).metadata();
        lw = m2.width ?? lw;
        lh = m2.height ?? maxLogoH;
      }
      logoTop = Math.min(logoTop, SRC - lh - Math.round(SRC * 0.06));
    }
  }

  // Design: a soft radial brand gradient (not a flat field) + the mint smile-arc
  // motif from the brand mark above the headline. Subtle, premium, on-brand.
  const bgTop = shadeHex(safeBg, 1.22);
  const bgBottom = shadeHex(safeBg, 0.78);
  const defs = `<defs><radialGradient id="bg" cx="50%" cy="34%" r="95%"><stop offset="0%" stop-color="${bgTop}"/><stop offset="100%" stop-color="${bgBottom}"/></radialGradient></defs>`;
  let motif = "";
  if (hasText) {
    const arcW = Math.round(SRC * 0.07);
    const arcY = Math.round(SRC * 0.222);
    const cx = SRC / 2;
    motif = `<path d="M ${cx - arcW} ${arcY} Q ${cx} ${arcY + Math.round(arcW * 1.1)} ${cx + arcW} ${arcY}" stroke="#cfe2d0" stroke-width="14" fill="none" stroke-linecap="round" opacity="0.92"/>`;
  }
  const svg = `<svg width="${SRC}" height="${SRC}" xmlns="http://www.w3.org/2000/svg">${defs}<rect width="100%" height="100%" fill="url(#bg)"/>${motif}${paths.join("")}</svg>`;

  const base = sharp(Buffer.from(svg));
  return (scaled
    ? base.composite([{ input: scaled, left: Math.round((SRC - lw) / 2), top: logoTop }])
    : base
  )
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** Resolve the closing-card CTA for a job: custom text wins, else goal-aware default. */
export function endCtaFor(
  job: { funnel_goal: string | null; cta_text: string | null; cta_subtext: string | null },
  brand: { tagline: string | null; clinic_name: string | null } | undefined,
): { cta: string; sub: string } {
  const map: Record<string, { cta: string; sub: string }> = {
    conversion: { cta: "Book your visit today", sub: brand?.tagline ?? "" },
    consideration: { cta: "See what’s possible", sub: brand?.tagline ?? "" },
    awareness: { cta: brand?.tagline || brand?.clinic_name || "Beyond Smiles", sub: "" },
  };
  const goal = (job.funnel_goal && map[job.funnel_goal]) || { cta: "Book your visit today", sub: brand?.tagline ?? "" };
  const custom = (job.cta_text ?? "").trim();
  const customSub = (job.cta_subtext ?? "").trim();
  return {
    cta: custom || goal.cta,
    sub: customSub || (custom ? brand?.tagline ?? "" : goal.sub),
  };
}

/**
 * Closing card at EXACT target dimensions (for appending to per-channel clips).
 * The square card is contain-fitted and padded with its own background color,
 * so non-square targets read as natively composed — text is never cropped.
 */
export async function buildEndCardImage(
  w: number,
  h: number,
  opts: { logoUrl?: string | null; bgColor?: string; cta?: string; subtext?: string },
): Promise<Buffer> {
  const bg = /^#[0-9a-fA-F]{3,8}$/.test(opts.bgColor ?? "") ? (opts.bgColor as string) : "#1F3A5F";
  const square = await buildEndCard(opts.logoUrl ?? null, bg, opts.cta, opts.subtext);
  return sharp(square).resize(w, h, { fit: "contain", background: bg }).jpeg({ quality: 92 }).toBuffer();
}

/** Duration (seconds) of a video file, parsed from ffmpeg's banner. */
export function videoDuration(path: string): Promise<number> {
  return new Promise((res, rej) => {
    if (!FFMPEG) return rej(new Error("ffmpeg binary not found (ffmpeg-static)"));
    const proc = spawn(FFMPEG, ["-i", path]);
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", rej);
    proc.on("close", () => {
      const m = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
      if (!m) return rej(new Error("could not read video duration"));
      res(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
  });
}

/**
 * Append a closing card (still image) to a finished clip with a short
 * crossfade. Video-only output (Kling clips are silent; the card adds no audio).
 */
export async function appendEndCard(
  inputPath: string,
  cardPath: string,
  outputPath: string,
  w: number,
  h: number,
  holdSeconds = 2.8,
): Promise<void> {
  const dur = await videoDuration(inputPath);
  const T = 0.5; // crossfade
  const off = Math.max(0.1, dur - T);
  await runFfmpeg([
    "-y",
    "-i", inputPath,
    "-loop", "1", "-t", (holdSeconds + T).toFixed(2), "-i", cardPath,
    "-filter_complex",
    `[0:v]scale=${w}:${h},setsar=1,fps=${FPS},format=yuv420p[a];[1:v]scale=${w}:${h},setsar=1,fps=${FPS},format=yuv420p[b];[a][b]xfade=transition=fade:duration=${T}:offset=${off.toFixed(3)}[v]`,
    "-map", "[v]",
    "-t", (off + T + holdSeconds).toFixed(2),
    "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ]);
}

// ── kinetic captions (burned onto video clips) ───────────────────────────────

export interface CaptionOpts {
  fill?: string; // text color (default white)
  position?: "lower" | "center"; // vertical placement (default lower-third)
  scrim?: boolean; // legibility gradient behind the text (default true)
}

/**
 * Render an editorial caption to a TRANSPARENT PNG at exact platform w×h, ready
 * to overlay 1:1 onto a clip. Reuses the vectorized glyph engine (Latin + Arabic
 * bidi via prepLine) so it renders on Vercel regardless of fonts, adds a subtle
 * lower-third scrim + drop shadow for legibility over any footage, and shrinks
 * the type to fit the safe width. Empty text → a fully transparent PNG (no-op).
 */
export async function renderCaptionPng(text: string, w: number, h: number, opts: CaptionOpts = {}): Promise<Buffer> {
  const clean = (text ?? "").trim();
  const fill = /^#[0-9a-fA-F]{3,6}$/.test(opts.fill ?? "") ? (opts.fill as string) : "#ffffff";
  const scrim = opts.scrim !== false;
  const pos = opts.position ?? "lower";

  if (!clean) {
    return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
  }

  // Wrap to ≤2 lines, put each into display (bidi) order.
  const rawLines = wrapLines(clean, 18, 2).map(prepLine);
  const maxW = w * 0.86;

  // Fit-to-width: start bold, shrink so the widest line fits the safe box.
  let fontSize = Math.round(w * 0.062);
  const widest = () => Math.max(...rawLines.map((ln) => lineWidth(ln, fontSize)));
  if (widest() > maxW) fontSize = Math.max(Math.floor(w * 0.03), Math.floor((fontSize * maxW) / widest()));
  const lineHeight = Math.round(fontSize * 1.16);

  const n = rawLines.length;
  // Last baseline: lower-third (above platform UI) or vertical center.
  const lastBaseline = pos === "center" ? Math.round(h / 2 + (n - 1) * lineHeight * 0.5) : Math.round(h * 0.84);
  const firstBaseline = lastBaseline - (n - 1) * lineHeight;

  const paths = rawLines.map((ln, i) => centeredLineIn(w, ln, firstBaseline + i * lineHeight, fontSize, fill)).join("");

  const blur = Math.max(2, Math.round(fontSize * 0.06));
  const dy = Math.max(1, Math.round(fontSize * 0.045));
  const shadow = `<filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="${blur}"/><feOffset dx="0" dy="${dy}" result="o"/><feFlood flood-color="#000000" flood-opacity="0.6"/><feComposite in2="o" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

  // Scrim gradient sits BEHIND the text (lower third) for legibility over any footage.
  const scrimTop = Math.max(Math.round(h * 0.5), firstBaseline - Math.round(fontSize * 1.7));
  const scrimGrad = scrim
    ? `<linearGradient id="scr" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#000000" stop-opacity="0.5"/></linearGradient>`
    : "";
  const scrimRect = scrim ? `<rect x="0" y="${scrimTop}" width="${w}" height="${h - scrimTop}" fill="url(#scr)"/>` : "";

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs>${shadow}${scrimGrad}</defs>${scrimRect}<g filter="url(#sh)">${paths}</g></svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Overlay a caption PNG (exact w×h) onto a clip, fading in shortly after the cut
 * and out before the next. This is a MID-CLIP alpha overlay (the rest of the
 * codebase only concat-appends). Audio is copied through untouched. If holdSecs
 * is omitted it's derived from the clip length.
 */
export async function overlayCaption(
  clipIn: string,
  pngPath: string,
  clipOut: string,
  opts: { fadeInAt?: number; holdSecs?: number; fadeDur?: number } = {},
): Promise<void> {
  const dur = await videoDuration(clipIn);
  const a = Math.min(opts.fadeInAt ?? 0.3, dur * 0.15);
  const hold = opts.holdSecs ?? Math.max(0.6, dur - a - 0.25);
  const fd = Math.min(opts.fadeDur ?? 0.4, hold / 2);
  await runFfmpeg([
    "-y",
    "-i", clipIn,
    "-loop", "1", "-t", hold.toFixed(2), "-i", pngPath,
    "-filter_complex",
    `[1:v]format=rgba,fade=t=in:st=0:d=${fd.toFixed(2)}:alpha=1,fade=t=out:st=${(hold - fd).toFixed(2)}:d=${fd.toFixed(2)}:alpha=1,setpts=PTS-STARTPTS+${a.toFixed(2)}/TB[cap];[0:v][cap]overlay=0:0:enable='between(t,${a.toFixed(2)},${(a + hold).toFixed(2)})':format=auto[v]`,
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    clipOut,
  ]);
}

/**
 * Mux a soundtrack (preset key or uploaded-track URL) into a finished video,
 * fitted to its exact length with fades. Video stream is copied (no re-encode).
 */
export async function muxMusicIntoVideo(videoPath: string, outputPath: string, choice: string): Promise<void> {
  const dir = join(tmpdir(), `cd-music-${randomUUID().slice(0, 8)}`);
  await mkdir(dir, { recursive: true });
  try {
    const seconds = await videoDuration(videoPath);
    const audio = await prepareMusicTrack(dir, choice, seconds);
    if (!audio) throw new Error("music track could not be prepared");
    await runFfmpeg([
      "-y",
      "-i", videoPath,
      "-i", audio,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
      "-shortest", "-movflags", "+faststart",
      outputPath,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Duration of any media file (video OR audio) — the banner parse works on mp3 too.
export const mediaDuration = videoDuration;

// ── cinematic reel assembly ──────────────────────────────────────────────────

/**
 * Concatenate finished clips (already at w×h) into ONE silent video with short
 * crossfades. Returns each clip's start offset in the final timeline + the total
 * duration, so a voiceover track can be aligned to the cut points. Video-only —
 * audio (music/VO) is muxed afterwards.
 */
export async function concatVideosXfade(
  clips: string[],
  out: string,
  w: number,
  h: number,
  crossfade = 0.5,
): Promise<{ offsets: number[]; total: number }> {
  if (!clips.length) throw new Error("concatVideosXfade: no clips");
  const durs: number[] = [];
  for (const c of clips) durs.push(await videoDuration(c));

  if (clips.length === 1) {
    await runFfmpeg([
      "-y", "-i", clips[0],
      "-vf", `scale=${w}:${h},setsar=1,fps=${FPS},format=yuv420p`,
      "-an",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      out,
    ]);
    return { offsets: [0], total: durs[0] };
  }

  // Crossfade ≤ 40% of the shortest clip so even a short beat stays visible.
  const T = Math.min(crossfade, Math.min(...durs) * 0.4);
  const inputs: string[] = [];
  for (const c of clips) inputs.push("-i", c);
  const parts: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    parts.push(`[${i}:v]scale=${w}:${h},setsar=1,fps=${FPS},format=yuv420p[v${i}]`);
  }
  const offsets = [0];
  let last = "v0";
  let acc = durs[0];
  for (let i = 1; i < clips.length; i++) {
    const o = i === clips.length - 1 ? "vout" : `x${i}`;
    parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${T.toFixed(3)}:offset=${(acc - T).toFixed(3)}[${o}]`);
    offsets.push(Math.max(0, acc - T)); // narration for beat i starts as it fades in
    last = o;
    acc = acc + durs[i] - T;
  }
  const total = acc; // sum(durs) - (n-1)*T
  await runFfmpeg([
    "-y", ...inputs,
    "-filter_complex", parts.join(";"),
    "-map", "[vout]",
    "-t", total.toFixed(3),
    "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    out,
  ]);
  return { offsets, total };
}

/**
 * Build ONE voiceover track: place each shot's VO clip at its offset in the reel
 * timeline (adelay), mix, pad/trim to `total` seconds. Missing/empty VO clips are
 * skipped. Adjacent narration lines may lightly overlap — that reads as natural
 * continuous VO (lines are written to flow).
 */
export async function assembleVoiceTrack(
  voPaths: (string | null)[],
  offsets: number[],
  total: number,
  out: string,
): Promise<void> {
  const present: { path: string; off: number }[] = [];
  voPaths.forEach((p, i) => {
    if (p) present.push({ path: p, off: Math.max(0, offsets[i] ?? 0) });
  });
  if (!present.length) throw new Error("assembleVoiceTrack: no voiceover clips");
  const inputs: string[] = [];
  const parts: string[] = [];
  present.forEach((v, i) => {
    inputs.push("-i", v.path);
    const ms = Math.round(v.off * 1000);
    parts.push(`[${i}:a]adelay=${ms}|${ms}[a${i}]`);
  });
  const labels = present.map((_, i) => `[a${i}]`).join("");
  parts.push(
    `${labels}amix=inputs=${present.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total.toFixed(3)},alimiter=limit=0.95[vo]`,
  );
  await runFfmpeg([
    "-y", ...inputs,
    "-filter_complex", parts.join(";"),
    "-map", "[vo]",
    "-c:a", "aac", "-b:a", "160k",
    out,
  ]);
}

/**
 * Mux voiceover and/or music under a finished video. When both are present the
 * music is DUCKED under the voice (sidechain compression), so narration stays
 * intelligible. Video stream is copied. voPath is a full-length aligned track
 * (assembleVoiceTrack); musicChoice is a preset key or http(s) url. Either null.
 */
export async function muxVoiceAndMusic(
  videoPath: string,
  voPath: string | null,
  musicChoice: string | null,
  out: string,
): Promise<void> {
  const dir = join(tmpdir(), `cd-mix-${randomUUID().slice(0, 8)}`);
  await mkdir(dir, { recursive: true });
  try {
    const seconds = await videoDuration(videoPath);
    const musicPath = musicChoice ? await prepareMusicTrack(dir, musicChoice, seconds) : null;

    if (voPath && musicPath) {
      // Duck the music while the voice speaks, then mix voice on top.
      await runFfmpeg([
        "-y", "-i", videoPath, "-i", musicPath, "-i", voPath,
        // asplit the voice: one copy triggers the sidechain duck, the other is
        // mixed on top (an ffmpeg label can only be consumed once).
        "-filter_complex",
        `[2:a]volume=1.6,asplit=2[v2a][v2b];[1:a]volume=1.0[m];[m][v2a]sidechaincompress=threshold=0.02:ratio=10:attack=5:release=350[md];[md][v2b]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.95[a]`,
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-shortest", "-movflags", "+faststart",
        out,
      ]);
      return;
    }
    const single = voPath ?? musicPath;
    if (single) {
      await runFfmpeg([
        "-y", "-i", videoPath, "-i", single,
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-shortest", "-movflags", "+faststart",
        out,
      ]);
      return;
    }
    // Nothing to add — keep the video as-is (silent).
    await runFfmpeg(["-y", "-i", videoPath, "-c:v", "copy", "-an", "-movflags", "+faststart", out]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
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
        const card = await buildEndCard(opts.endCard.logoUrl ?? null, opts.endCard.bgColor || "#1F3A5F", opts.endCard.cta, opts.endCard.subtext);
        const p = join(dir, `src-end.jpg`);
        await writeFile(p, card);
        frames.push({ path: p, holdSeconds: opts.endCard.holdSeconds ?? 3.0, motion: "zoom-in" });
      } catch (e) {
        // no end-card is better than no video — but surface why it failed
        console.error("[montage] end-card failed:", e instanceof Error ? (e.stack ?? e.message) : String(e));
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