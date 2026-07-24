// Channel presets, grouped GMB / Paid / Organic. One AI master is generated once
// and finished (cropped + logo-stamped) into one deliverable per selected channel.
// sharp/ffmpeg do the exact crop, so the fal gen fields only steer a close aspect.

export type ChannelFamily = "gmb" | "paid" | "organic";

export interface Platform {
  key: string;
  label: string;
  family: ChannelFamily;
  w: number;
  h: number;
  ratio: string;
  falImageSize: string; // FLUX text2image preset (closest)
  falAspect: string; // Kontext aspect_ratio enum (closest)
  maxDurationSeconds?: number; // for video
}

// Map a target ratio to the nearest fal generation hints.
function gen(ratio: string): { falImageSize: string; falAspect: string } {
  switch (ratio) {
    case "1:1":
      return { falImageSize: "square_hd", falAspect: "1:1" };
    case "4:5":
    case "2:3":
      return { falImageSize: "portrait_4_3", falAspect: "3:4" };
    case "3:4":
      return { falImageSize: "portrait_4_3", falAspect: "3:4" };
    case "9:16":
      return { falImageSize: "portrait_16_9", falAspect: "9:16" };
    case "4:3":
    case "6:5":
      return { falImageSize: "landscape_4_3", falAspect: "4:3" };
    default: // 16:9, 1.91:1, leaderboard, etc. — wide
      return { falImageSize: "landscape_16_9", falAspect: "16:9" };
  }
}

function p(
  key: string,
  label: string,
  family: ChannelFamily,
  w: number,
  h: number,
  ratio: string,
  maxDurationSeconds?: number,
): Platform {
  return { key, label, family, w, h, ratio, ...gen(ratio), maxDurationSeconds };
}

export const PLATFORM_LIST: Platform[] = [
  // ── GMB (Google Business Profile) ──
  p("gmb_square", "GBP square", "gmb", 1080, 1080, "1:1"),
  p("gmb_post_landscape", "GBP post (4:3)", "gmb", 1200, 900, "4:3"),
  p("gmb_cover", "GBP cover (16:9)", "gmb", 1080, 608, "16:9"),
  p("gmb_logo", "GBP logo / profile", "gmb", 720, 720, "1:1"),
  // ── Paid social ──
  p("paid_meta_feed_45", "Meta/IG feed ad (4:5)", "paid", 1080, 1350, "4:5"),
  p("paid_meta_feed_11", "Meta/IG feed ad (1:1)", "paid", 1080, 1080, "1:1"),
  p("paid_meta_link_191", "Meta link ad (1.91:1)", "paid", 1200, 628, "1.91:1"),
  p("paid_story_reel_916", "Stories/Reels ad (9:16)", "paid", 1080, 1920, "9:16", 60),
  // ── Organic social ──
  p("org_ig_feed_45", "Instagram feed (4:5)", "organic", 1080, 1350, "4:5"),
  p("org_ig_feed_11", "Instagram feed (1:1)", "organic", 1080, 1080, "1:1"),
  p("org_ig_story_reel_916", "IG Story / Reel (9:16)", "organic", 1080, 1920, "9:16", 90),
  p("org_fb_feed_191", "Facebook feed (1.91:1)", "organic", 1200, 630, "1.91:1"),
  p("org_tiktok_916", "TikTok (9:16)", "organic", 1080, 1920, "9:16", 180),
  p("org_yt_short_916", "YouTube Shorts (9:16)", "organic", 1080, 1920, "9:16", 60),
  p("org_yt_thumb_169", "YouTube thumbnail (16:9)", "organic", 1280, 720, "16:9"),
  p("org_pinterest_23", "Pinterest pin (2:3)", "organic", 1000, 1500, "2:3"),
];

export const PLATFORMS: Record<string, Platform> = Object.fromEntries(
  PLATFORM_LIST.map((pl) => [pl.key, pl]),
);

export const FAMILY_LABELS: Record<ChannelFamily, string> = {
  gmb: "Google Business",
  paid: "Paid social",
  organic: "Organic social",
};

export const PLATFORM_GROUPS: { family: ChannelFamily; label: string; presets: Platform[] }[] = (
  ["gmb", "paid", "organic"] as ChannelFamily[]
).map((family) => ({
  family,
  label: FAMILY_LABELS[family],
  presets: PLATFORM_LIST.filter((pl) => pl.family === family),
}));

export function platformOf(key: string | null | undefined): Platform {
  return (key && PLATFORMS[key]) || PLATFORMS.gmb_square;
}

// Goal/intent → a sensible default channel bundle.
export function defaultPlatforms(family?: ChannelFamily): string[] {
  if (family === "gmb") return ["gmb_square", "gmb_post_landscape"];
  if (family === "paid") return ["paid_meta_feed_45", "paid_story_reel_916"];
  if (family === "organic") return ["org_ig_feed_45", "org_ig_story_reel_916"];
  return ["gmb_square", "org_ig_feed_45", "org_ig_story_reel_916"]; // a bit of each
}

// Carousel: a post can hold 1 (single) … MAX_CAROUSEL slides/items.
export const MAX_CAROUSEL = 6;
export const carouselCounts = () => Array.from({ length: MAX_CAROUSEL }, (_, i) => i + 1);
export function clampCarousel(n: unknown): number {
  return Math.min(Math.max(Math.round(Number(n) || 1), 1), MAX_CAROUSEL);
}

// The AI master is generated square so it crops cleanly to any channel ratio.
export const MASTER_IMAGE_SIZE = "square_hd";
export const MASTER_ASPECT = "1:1";

export const LOGO_POSITIONS = ["bottom-right", "bottom-left", "top-right", "top-left"] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];
