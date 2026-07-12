import { spawn } from "node:child_process";
import { join } from "node:path";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import ffmpegStatic from "ffmpeg-static";
import { loadLogoBuffer } from "./finish";

// Photo-montage rendering: N still photos → one cinematic Ken Burns video
// (pan/zoom per shot, hard cuts, global fade in/out, optional brand end-card).
// Deterministic ffmpeg — no AI render credits. The master is SQUARE (like the
// image pipeline) so finishVideo() can cover-crop it to every channel ratio.
// FFMPEG_PATH overrides the bundled binary (local dev/test).

const FFMPEG = process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string);

// Master canvas. Square crops acceptably to both 9:16 and 16:9, mirroring
// MASTER_ASPECT for images. Sources are pre-scaled 1.5× for zoom headroom.
const MASTER = 1440;
const SRC = 2160;
const FPS = 30;
/** Peak zoom for the Ken Burns move — subtle, premium, never seasick. */
const ZOOM = 1.12;

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

function zoompanExprs(motion: MontageMotion, frames: number): { z: string; x: string; y: string } {
  const span = (ZOOM - 1).toFixed(4);
  const center = { x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" };
  switch (motion) {
    case "zoom-in":
      return { z: `1+(${span}*on/${frames})`, ...center };
    case "zoom-out":
      return { z: `${ZOOM}-(${span}*on/${frames})`, ...center };
    case "pan-left":
      // camera drifts leftward: crop window slides right → left
      return { z: `${ZOOM}`, x: `(iw-iw/zoom)*(1-on/${frames})`, y: center.y };
    case "pan-right":
      return { z: `${ZOOM}`, x: `(iw-iw/zoom)*(on/${frames})`, y: center.y };
  }
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
    // 1 · normalize every photo (EXIF rotation, cover-crop to the padded square).
    // One bad/unreachable photo skips that shot instead of sinking the montage.
    const frames: { path: string; holdSeconds: number; motion: MontageMotion }[] = [];
    for (let i = 0; i < shots.length; i++) {
      try {
        const buf = await fetchImage(shots[i].imageUrl);
        const jpg = await sharp(buf)
          .rotate() // honor EXIF orientation
          .resize(SRC, SRC, { fit: "cover", position: "attention" })
          .jpeg({ quality: 92 })
          .toBuffer();
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

    // 2 · one Ken Burns clip per photo (identical codec/size/fps → copy-concat)
    const clips: string[] = [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const hold = Math.min(Math.max(f.holdSeconds, 1.2), 6);
      const nFrames = Math.max(2, Math.round(hold * FPS));
      const e = zoompanExprs(f.motion, nFrames);
      const clip = join(dir, `clip-${i}.mp4`);
      await runFfmpeg([
        "-y",
        "-i", f.path,
        "-filter_complex",
        `zoompan=z='${e.z}':x='${e.x}':y='${e.y}':d=${nFrames}:s=${MASTER}x${MASTER}:fps=${FPS},format=yuv420p`,
        "-frames:v", String(nFrames),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        clip,
      ]);
      clips.push(clip);
    }

    // 3 · concat (stream copy — all clips share codec/size/fps)
    const listPath = join(dir, "list.txt");
    await writeFile(listPath, clips.map((c) => `file '${c}'`).join("\n"));
    const rawPath = join(dir, "master-raw.mp4");
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", rawPath]);

    // 4 · global fade in/out + faststart
    const total = frames.reduce((a, f) => a + Math.min(Math.max(f.holdSeconds, 1.2), 6), 0);
    const outPath = join(dir, "master.mp4");
    await runFfmpeg([
      "-y",
      "-i", rawPath,
      "-vf", `fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0, total - 0.7).toFixed(2)}:d=0.7`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-movflags", "+faststart",
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
