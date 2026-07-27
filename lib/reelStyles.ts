// Reel "house styles" — the look & rhythm of a finished reel, inspired by how
// different categories of brand cut their films. A style is more than a prompt:
// it sets the colour grade applied to every shot, the caption typography &
// placement, the cut pacing, and the default music bed. Styles are AESTHETIC
// direction only — we never reproduce another brand's marks, names or assets.

export interface ReelStyle {
  key: string;
  label: string;
  blurb: string;
  /** ffmpeg video filter applied to each shot (colour grade). Empty = untouched. */
  grade: string;
  caption: {
    upper: boolean;
    /** cap height as a fraction of frame width */
    size: number;
    position: "lower" | "center";
    color: string;
    scrim: boolean;
  };
  /** crossfade duration between shots (seconds) — pacing feel */
  crossfade: number;
  /** default soundtrack preset key */
  music: string;
  /** extra art direction folded into generated-imagery prompts */
  promptGuidance: string;
}

export const REEL_STYLES: ReelStyle[] = [
  {
    key: "auto",
    label: "Auto (brand default)",
    blurb: "Clean, premium and on-brand — a safe, versatile look.",
    grade: "",
    caption: { upper: false, size: 0.062, position: "lower", color: "#ffffff", scrim: true },
    crossfade: 0.5,
    music: "warm",
    promptGuidance: "Premium, calm, trustworthy and on-brand.",
  },
  {
    key: "wellness",
    label: "Wellness clinic — calm & editorial (SAMA-style)",
    blurb:
      "Soft, airy and unhurried: muted warm neutrals, elegant lowercase captions, slow dissolves. Reads as a premium wellness brand.",
    // lifted blacks + gentle warmth + slight desaturation = soft editorial film
    grade: "eq=contrast=0.94:saturation=0.88:brightness=0.03,colorbalance=rm=0.04:gm=0.01:bh=-0.03",
    caption: { upper: false, size: 0.055, position: "lower", color: "#ffffff", scrim: true },
    crossfade: 0.8,
    music: "calm",
    promptGuidance:
      "Serene wellness editorial: soft diffused daylight, muted warm neutrals (bone, sand, oat), uncluttered negative space, unhurried and considered, quietly premium.",
  },
  {
    key: "commercial",
    label: "Friendly commercial — bright & clear (Aspen-style)",
    blurb:
      "Bright, upbeat and benefit-led with bold readable captions and snappy cuts. The classic high-clarity healthcare ad look.",
    grade: "eq=contrast=1.06:saturation=1.08:brightness=0.02",
    caption: { upper: false, size: 0.068, position: "lower", color: "#ffffff", scrim: true },
    crossfade: 0.35,
    music: "upbeat",
    promptGuidance:
      "Bright, friendly, high-key commercial: clean even lighting, optimistic and welcoming, clear single focal point, reassuring and approachable.",
  },
  {
    key: "luxe_warm",
    label: "Warm luxe — rich & filmic (Gucci-style)",
    blurb:
      "Rich warm film grade with deep colour and generous type — opulent, tactile, fashion-house warmth.",
    grade: "eq=contrast=1.12:saturation=1.14,colorbalance=rs=0.06:rm=0.05:gh=-0.02:bh=-0.05",
    caption: { upper: false, size: 0.072, position: "center", color: "#ffffff", scrim: false },
    crossfade: 0.6,
    music: "warm",
    promptGuidance:
      "Rich warm filmic luxury: golden directional light, deep saturated jewel tones, tactile textures (velvet, marble, brass), opulent and characterful, shot on film.",
  },
  {
    key: "mono_couture",
    label: "Monochrome couture — timeless (Chanel-style)",
    blurb:
      "Black-and-white elegance with restrained centred type. Timeless, refined, unmistakably high-end.",
    grade: "hue=s=0,eq=contrast=1.16:brightness=0.02",
    caption: { upper: false, size: 0.062, position: "center", color: "#ffffff", scrim: false },
    crossfade: 0.7,
    music: "calm",
    promptGuidance:
      "Timeless monochrome couture: sculptural light and shadow, impeccable tailoring and grooming, restrained and elegant, classic composition, nothing superfluous.",
  },
  {
    key: "brutalist",
    label: "High-fashion brutalist — stark & bold (Balenciaga-style)",
    blurb:
      "Cold desaturated grade, ALL-CAPS captions, hard fast cuts. Severe, modern, scroll-stopping.",
    grade: "eq=contrast=1.2:saturation=0.72:brightness=-0.02,colorbalance=bh=0.05:rh=-0.03",
    caption: { upper: true, size: 0.058, position: "lower", color: "#ffffff", scrim: false },
    crossfade: 0.2,
    music: "upbeat",
    promptGuidance:
      "Stark high-fashion brutalism: cold desaturated palette, hard directional light, severe symmetry, concrete/steel/glass surfaces, deadpan and modern, uncompromising.",
  },
];

export const REEL_STYLE_KEYS = REEL_STYLES.map((s) => s.key);

export function reelStyle(key: string | null | undefined): ReelStyle {
  return REEL_STYLES.find((s) => s.key === key) ?? REEL_STYLES[0];
}
