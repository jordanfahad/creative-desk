import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import ffmpegStatic from "ffmpeg-static";
import { loadLogoBuffer, type FinishOpts } from "./finish";

// Deterministic VIDEO finishing via ffmpeg: cover-scale + crop to the exact
// platform dimensions, composite the brand logo at a corner, preserve audio.
// Mirrors finishImage so a clip and a still get the same channel treatment.

const FFMPEG = ffmpegStatic as unknown as string;

export interface VideoFinishOpts extends FinishOpts {
  trim?: { start?: number; duration?: number };
  /** Hide the corner logo after this many seconds (e.g. while a baked brand
   *  end-card is on screen, so the logo isn't shown twice). */
    logoEnableBefore?: number;
  /**
   * Fit the whole frame into W×H (letterbox) instead of cover-cropping. For
   * montage posts that carry baked-in text, cropping a square master to a 9:16
   * story/16:9 landscape would slice the artwork; letterboxing centers it on a
   * blurred fill of itself so every pixel survives. For a 1:1 output it's a
   * no-op (contain == cover). Real-footage paths leave this off (crop is right).
   */
  letterbox?: boolean;
}

export async function finishVideo(
  inputPath: string,
  outputPath: string,
  opts: VideoFinishOpts,
): Promise<void> {
  const { platform } = opts;
  const W = platform.w;
  const H = platform.h;
  const margin = Math.round(W * 0.04);

  // The logo may be a Supabase URL (hosted) or a local file path (dev). ffmpeg
  // needs a local file, so download a URL logo to /tmp. Degrade gracefully — a
  // missing/unreadable logo renders the clip without it instead of failing.
  let localLogo: string | null = null;
  let tempLogo: string | null = null;
  if (opts.logoEnabled && opts.logoPath) {
    try {
      if (/^https?:\/\//.test(opts.logoPath)) {
        tempLogo = join(tmpdir(), `cd-logo-${randomUUID().slice(0, 8)}.png`);
        await writeFile(tempLogo, await loadLogoBuffer(opts.logoPath));
        localLogo = tempLogo;
      } else {
        localLogo = resolve(opts.logoPath);
      }
    } catch {
      localLogo = null;
    }
  }
  const useLogo = !!localLogo;

  const args: string[] = ["-y"];
  if (opts.trim?.start) args.push("-ss", String(opts.trim.start));
  args.push("-i", inputPath);
  if (useLogo) args.push("-i", localLogo as string);

  // cover-crop the base video to W×H
  let filter = opts.letterbox ? `[0:v]split=2[lbbg][lbfg];[lbbg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=28,eq=brightness=-0.12[lbb];[lbfg]scale=${W}:${H}:force_original_aspect_ratio=decrease[lbf];[lbb][lbf]overlay=(W-w)/2:(H-h)/2,setsar=1` : `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
  if (useLogo) {
    const lw = Math.max(48, Math.min(Math.round(W * (opts.logoScale ?? 0.2)), W - 2 * margin));
    const pos = opts.logoPosition ?? "bottom-right";
    const x = pos.includes("left") ? `${margin}` : `main_w-overlay_w-${margin}`;
    const y = pos.includes("top") ? `${margin}` : `main_h-overlay_h-${margin}`;
    const enable =
      opts.logoEnableBefore != null && opts.logoEnableBefore > 0
        ? `:enable='lt(t,${opts.logoEnableBefore.toFixed(2)})'`
        : "";
    filter += `[bg];[1:v]scale=${lw}:-1[lg];[bg][lg]overlay=${x}:${y}${enable}[v]`;
  } else {
    filter += `[v]`;
  }

  args.push(
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "0:a?", // keep audio if present
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
  );
  if (opts.trim?.duration) args.push("-t", String(opts.trim.duration));
  args.push(outputPath);

  try {
    await runFfmpeg(args);
  } finally {
    if (tempLogo) await unlink(tempLogo).catch(() => {});
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
