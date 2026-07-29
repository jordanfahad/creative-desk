import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Platform, LogoPosition } from "./platform";

// Deterministic finishing: crop/resize an image to the exact platform dimensions
// (smart-cropping to the salient region), then composite the brand logo onto a
// corner. The logo is clamped to fit and the whole thing degrades gracefully —
// a bad/oversized logo never crashes a render.

// The brand logo path is a Supabase public URL on the hosted build and a local
// file path in the local dev build — load either.
export async function loadLogoBuffer(logoPath: string): Promise<Buffer> {
  if (/^https?:\/\//.test(logoPath)) {
    const res = await fetch(logoPath);
    if (!res.ok) throw new Error(`logo fetch failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(resolve(logoPath));
}

/**
 * A logo stamped over UNKNOWN footage needs its own contrast: a mint mark
 * vanishes on a white clinic wall, a navy one vanishes on dark footage. This
 * builds a soft dark halo from the logo's own silhouette and composites the
 * logo on top, so either variant stays legible on any background — without
 * putting a hard box on screen.
 *
 * Used for VIDEO corner watermarks only; the closing card sits on a known brand
 * colour and needs no halo.
 */
export async function loadLogoForOverlay(logoPath: string): Promise<Buffer> {
  const raw = await loadLogoBuffer(logoPath);
  const img = sharp(raw).ensureAlpha();
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return raw;

  // Pad so the blur has somewhere to fall, then build a black silhouette from
  // the alpha channel and blur it into a glow.
  const pad = Math.max(6, Math.round(Math.min(w, h) * 0.12));
  const W = w + pad * 2;
  const H = h + pad * 2;
  const padded = await sharp(raw)
    .ensureAlpha()
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const alpha = await sharp(padded).extractChannel("alpha").toBuffer();
  const halo = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .joinChannel(alpha)
    .blur(Math.max(2, pad * 0.5))
    .png()
    .toBuffer();

  // Two passes of the glow deepen it just enough to read on white.
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: halo }, { input: halo }, { input: padded }])
    .png()
    .toBuffer();
}

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
      const logoBuf = await loadLogoBuffer(opts.logoPath);
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
