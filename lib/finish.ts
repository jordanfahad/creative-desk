import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Platform, LogoPosition } from "./platform";

// Deterministic finishing: crop/resize an image to the exact platform dimensions
// (smart-cropping to the salient region), then composite the brand logo onto a
// corner. The logo is clamped to fit and the whole thing degrades gracefully —
// a bad/oversized logo never crashes a render.

export interface FinishOpts {
  platform: Platform;
  logoPath?: string | null; // storage-relative path to the brand logo PNG
  logoEnabled?: boolean;
  logoPosition?: LogoPosition;
  logoScale?: number; // logo width as a fraction of canvas width (default 0.2)
}

export async function finishImage(input: Buffer, opts: FinishOpts): Promise<Buffer> {
  const { platform } = opts;
  const base = sharp(input).resize(platform.w, platform.h, {
    fit: "cover",
    position: "attention",
  });

  if (opts.logoEnabled && opts.logoPath) {
    try {
      const logoBuf = await readFile(resolve(opts.logoPath));
      const margin = Math.round(platform.w * 0.04);
      const maxW = platform.w - 2 * margin;
      const maxH = platform.h - 2 * margin;
      if (maxW > 0 && maxH > 0) {
        const wantW = Math.max(24, Math.round(platform.w * (opts.logoScale ?? 0.2)));
        let resized = await sharp(logoBuf).resize({ width: Math.min(wantW, maxW) }).png().toBuffer();
        let m = await sharp(resized).metadata();
        let lw = m.width ?? wantW;
        let lh = m.height ?? Math.round(wantW * 0.4);
        if (lh > maxH) {
          resized = await sharp(logoBuf).resize({ height: maxH }).png().toBuffer();
          m = await sharp(resized).metadata();
          lw = m.width ?? lw;
          lh = m.height ?? maxH;
        }
        if (lw <= maxW && lh <= maxH) {
          const pos: LogoPosition = opts.logoPosition ?? "bottom-right";
          const left = pos.includes("left") ? margin : platform.w - lw - margin;
          const top = pos.includes("top") ? margin : platform.h - lh - margin;
          base.composite([{ input: resized, top, left }]);
        }
      }
    } catch {
      // logo missing/unreadable/too big — skip the overlay
    }
  }

  try {
    return await base.jpeg({ quality: 90 }).toBuffer();
  } catch {
    // a bad composite op shouldn't lose the render — emit the un-logo'd crop
    return sharp(input)
      .resize(platform.w, platform.h, { fit: "cover", position: "attention" })
      .jpeg({ quality: 90 })
      .toBuffer();
  }
}
