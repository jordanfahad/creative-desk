// Visual style presets — steer the prompt optimizer toward a chosen aesthetic.
// Picked per job; injected into the gpt-4o prompt-engineer system message.
export interface StylePreset {
  key: string;
  label: string;
  guidance: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    key: "auto",
    label: "Auto (let AI choose)",
    guidance: "Choose the most fitting premium, on-brand style for this brief.",
  },
  {
    key: "editorial",
    label: "Editorial",
    guidance:
      "High-end editorial photography: art-directed and styled, magazine-quality, refined composition, controlled soft light, shallow depth of field, elegant and aspirational.",
  },
  {
    key: "warm_lifestyle",
    label: "Warm lifestyle",
    guidance:
      "Candid warm lifestyle: genuine real moments and human warmth, soft golden natural daylight, relaxed and approachable, authentic not posed.",
  },
  {
    key: "clinical_clean",
    label: "Clinical-clean",
    guidance:
      "Bright, minimal, hyper-clean modern clinic: crisp whites, airy high-key light, spotless surfaces, calm and reassuring, generous negative space, trust-building.",
  },
  {
    key: "cinematic",
    label: "Cinematic",
    guidance:
      "Cinematic: filmic color grade, soft directional light, gentle bokeh, subtle contrast and depth, premium mood — tasteful and warm, never dark or clinical-scary.",
  },
  {
    key: "bright_friendly",
    label: "Bright & friendly",
    guidance:
      "Bright, friendly, high-key: light and airy, fresh and optimistic, welcoming smiling people, soft tones aligned to the brand palette.",
  },
];

export const STYLE_KEYS = STYLE_PRESETS.map((p) => p.key);

export function styleLabel(key: string): string {
  return STYLE_PRESETS.find((p) => p.key === key)?.label ?? "Auto";
}

export function styleGuidance(key: string): string {
  return (STYLE_PRESETS.find((p) => p.key === key) ?? STYLE_PRESETS[0]).guidance;
}

// A brand-safe baseline of things to steer away from — used as the Kling
// negative_prompt and as a floor the optimizer's per-shot `negative` extends.
export const BASE_NEGATIVE =
  "low quality, blurry, distorted, deformed hands, extra fingers, malformed or unnaturally white teeth, plastic or waxy skin, cartoon, 3d render, cgi, stock-photo cheesiness, watermark, text, logo, caption, oversaturated, harsh lighting, cluttered background";
