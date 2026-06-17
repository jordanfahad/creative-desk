import { z } from "zod";
import {
  db,
  getAssetsByIds,
  type Asset,
  type BrandKit,
  type Guideline,
  type Job,
} from "./db";

// ── The context store ────────────────────────────────────────────────
// "Give the model the guidelines once" = store once (brand_kit + guidelines),
// re-inject every time. THIS FILE is that mechanism. No model training.
//
// assembleContext() pulls the brand kit + active guidelines + the assets a
// job selected, and renders one text block that gets prepended to every
// brief request.

export interface AssembledContext {
  block: string; // the text injected into the model's system prompt
  assets: Asset[]; // resolved source assets for the job
}

// Max characters of any single guideline injected per request (large brand
// docs are stored in full but truncated here to keep prompts lean).
const GUIDELINE_INJECT_CAP = 9000;

function safeJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function assembleContext(job: Job): AssembledContext {
  const brand = db
    .prepare("SELECT * FROM brand_kit WHERE id = 1")
    .get() as BrandKit | undefined;

  const guidelines = db
    .prepare("SELECT * FROM guidelines WHERE active = 1 ORDER BY created_at")
    .all() as Guideline[];

  const assetIds = safeJsonArray(job.asset_ids).map(Number).filter(Number.isFinite);
  const assets = getAssetsByIds(assetIds);

  const lines: string[] = [];

  lines.push("# Brand context (re-injected for every generation)");
  if (brand) {
    if (brand.clinic_name) lines.push(`Clinic: ${brand.clinic_name}`);
    if (brand.tagline) lines.push(`Tagline: ${brand.tagline}`);
    if (brand.voice) lines.push(`Voice / tone: ${brand.voice}`);
    const colors = safeJsonArray(brand.colors);
    if (colors.length) lines.push(`Brand colors: ${colors.join(", ")}`);
    const fonts = safeJsonArray(brand.fonts);
    if (fonts.length) lines.push(`Fonts: ${fonts.join(", ")}`);
    if (brand.boilerplate) lines.push(`Boilerplate: ${brand.boilerplate}`);

    const doNotSay = safeJsonArray(brand.do_not_say);
    if (doNotSay.length) {
      lines.push("");
      lines.push("## Hard guardrails — never imply or claim:");
      for (const item of doNotSay) lines.push(`- ${item}`);
    }
  } else {
    lines.push("(No brand kit configured yet.)");
  }

  if (guidelines.length) {
    // Grouped by who issued them, highest authority first. CEO directives are
    // framed as non-negotiable so the model treats them above creative-team
    // guidance when they ever conflict.
    const groups: Array<{ source: string; heading: string }> = [
      { source: "ceo", heading: "# CEO directives — highest priority, must be honored" },
      { source: "creative", heading: "# Creative guidelines" },
      { source: "general", heading: "# Guidelines" },
    ];
    for (const { source, heading } of groups) {
      const items = guidelines.filter((g) => (g.source || "general") === source);
      if (!items.length) continue;
      lines.push("");
      lines.push(heading);
      for (const g of items) {
        lines.push(`## ${g.title}`);
        // Cap per-guideline injected length so large brand docs don't bloat
        // every prompt; the full text stays in the DB and the PDF is attached.
        lines.push(
          g.body.length > GUIDELINE_INJECT_CAP
            ? g.body.slice(0, GUIDELINE_INJECT_CAP) + "\n…[truncated — full document attached]"
            : g.body,
        );
      }
    }
  }

  if (assets.length) {
    lines.push("");
    lines.push("# Source assets selected for this job");
    for (const a of assets) {
      lines.push(
        `- [#${a.id}] ${a.filename} — kind: ${a.kind}, quality: ${a.quality}` +
          (a.notes ? `, notes: ${a.notes}` : ""),
      );
    }
  }

  return { block: lines.join("\n"), assets };
}

// ── Brief schema ─────────────────────────────────────────────────────
// The structured shape the model must return. Shared by the generate-brief
// route (as the response format) and the result gallery (as the brief it
// renders). One unified shape for both static + dynamic; `mode` selects
// which fields matter. The renderer returns single clips/stills, so a video
// brief is a LIST of clips PLUS assembly instructions — the final cut
// (music, captions, logo) happens in your editor.

export const ShotSchema = z.object({
  index: z.number().int().describe("0-based order of this shot/clip in the piece"),
  source_asset_id: z
    .number()
    .int()
    .nullable()
    .describe("id of the source asset this shot is built from, or null for text->image"),
  prompt: z.string().max(2000).describe("the image/video generation prompt for this shot"),
  motion: z
    .string()
    .max(500)
    .describe("camera/subject motion for a video clip; empty string for a still"),
  aspect_ratio: z.string().describe("e.g. 9:16, 1:1, 16:9"),
  duration_seconds: z
    .number()
    .describe("clip length in seconds; 0 for a static still"),
  caption: z.string().max(600).describe("on-screen or post caption text for this shot"),
});

export const BriefSchema = z.object({
  mode: z.enum(["static", "dynamic"]),
  concept: z.string().max(2000).describe("one-paragraph creative concept for the piece"),
  shots: z
    .array(ShotSchema)
    .max(20)
    .describe("ordered list of stills (static) or clips (dynamic); at most a handful"),
  assembly_instructions: z
    .string()
    .max(2000)
    .describe(
      "how to stitch the returned clips/stills into the final piece — music mood, caption burn-in, logo sting, cut timing. Done in your editor.",
    ),
  post_caption: z.string().max(600).describe("the caption/copy for the published post"),
});

export type Brief = z.infer<typeof BriefSchema>;
export type Shot = z.infer<typeof ShotSchema>;
