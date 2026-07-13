import { spawn } from "node:child_process";
import { join } from "node:path";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import ffmpegStatic from "ffmpeg-static";
import { loadLogoBuffer } from "./finish";

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
  /** Optional closing brand card: logo centered on a brand-color field. */
  endCard?: { logoUrl: string; bgColor?: string; holdSeconds?: number } | null;
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

/** Compose the closing brand card: brand-color field, logo centered. */
async function buildEndCard(logoUrl: string, bgColor: string): Promise<Buffer> {
  const logo = await loadLogoBuffer(logoUrl);
  const logoW = Math.round(SRC * 0.42);
  const scaled = await sharp(logo).resize({ width: logoW }).png().toBuffer();
  const meta = await sharp(scaled).metadata();
  const lw = meta.width ?? logoW;
  const lh = meta.height ?? Math.round(logoW * 0.4);
  return sharp({
    create: { width: SRC, height: SRC, channels: 3, background: bgColor },
  })
    .composite([{ input: scaled, left: Math.round((SRC - lw) / 2), top: Math.round((SRC - lh) / 2) }])
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
 * Render the montage master (square MP4, silent — music is added in the
 * editor per the brief's assembly instructions). Returns the MP4 buffer.
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
        const card = await buildEndCard(opts.endCard.logoUrl, opts.endCard.bgColor || "#1F3A5F");
        const p = join(dir, `src-end.jpg`);
        await writeFile(p, card);
        frames.push({ path: p, holdSeconds: opts.endCard.holdSeconds ?? 2.2, motion: "zoom-in" });
      } catch {
        // no end-card is better than no video
      }
    }

    // 2 · assemble in ONE ffmpeg graph: each still is held STATIC for its hold,
    // dissolving into the next with a crossfade (no zoom/pan → no vibration),
    // then a global fade in/out. Every still is scaled to the square master at a
    // fixed fps so the xfade chain lines up.
    const holds = frames.map((f) => Math.min(Math.max(f.holdSeconds, 1.2), 6));
    const n = frames.length;
    const outPath = join(dir, "master.mp4");

    if (n === 1) {
      await runFfmpeg([
        "-y",
        "-loop", "1", "-t", holds[0].toFixed(3), "-i", frames[0].path,
        "-vf", `scale=${MASTER}:${MASTER},setsar=1,fps=${FPS},format=yuv420p,fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0, holds[0] - 0.7).toFixed(2)}:d=0.7`,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        outPath,
      ]);
      return await readFile(outPath);
    }

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
    const total = acc; // = sum(holds) - (n-1)*T
    parts.push(
      `[${last}]fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0, total - 0.7).toFixed(2)}:d=0.7[vout]`,
    );

    await runFfmpeg([
      "-y",
      ...inputs,
      "-filter_complex", parts.join(";"),
      "-map", "[vout]",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}