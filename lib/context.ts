import { z } from "zod";
import { getBrandKit, listGuidelines, getAssetsByIds, jobInspirationIds, isMontageJob, isReelJob, type Asset, type Job } from "./db";
import { styleGuidance, styleLabel, BASE_NEGATIVE } from "./style";
import { clampCarousel, reelShotCount } from "./platform";
import { reelStyle } from "./reelStyles";

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
  inspiration: Asset[]; // resolved style-reference images ("make it like this")
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

export async function assembleContext(job: Job): Promise<AssembledContext> {
  const brand = await getBrandKit(job.project_id);
  const guidelines = (await listGuidelines(job.project_id)).filter((g) => g.active);

  const assetIds = safeJsonArray(job.asset_ids).map(Number).filter(Number.isFinite);
  const assets = await getAssetsByIds(assetIds);
  const inspiration = (await getAssetsByIds(jobInspirationIds(job))).filter((a) => a.media !== "video");

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

  // Montage curation may only pick PHOTOS — don't offer video-asset ids.
  const listable = isMontageJob(job) ? assets.filter((a) => a.media !== "video") : assets;
  if (listable.length) {
    lines.push("");
    lines.push("# Source assets selected for this job");
    for (const a of listable) {
      lines.push(
        `- [#${a.id}] ${a.filename} — kind: ${a.kind}, quality: ${a.quality}` +
          (a.notes ? `, notes: ${a.notes}` : ""),
      );
    }
  }

  if (inspiration.length) {
    lines.push("");
    lines.push("# Inspiration references — the LOOK the user wants (style, not content)");
    for (const a of inspiration) {
      lines.push(`- [ref #${a.id}] ${a.filename}${a.notes ? ` — borrow: ${a.notes}` : " — borrow: overall look (color grade, lighting, composition, mood)"}`);
    }
  }

  return { block: lines.join("\n"), assets, inspiration };
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
  prompt: z
    .string()
    .max(2000)
    .describe(
      "A COMPLETE, production-grade generation prompt for this single shot — a vivid 45-120 word paragraph the renderer sees verbatim. It MUST specify: subject + wardrobe, setting, composition/framing, lighting, lens/camera, brand color grade (use the brand hex codes), mood (matching the brand voice), and photorealism cues. Self-contained: assume the renderer has NO other context.",
    ),
  motion: z
    .string()
    .max(500)
    .describe("camera/subject motion for a video clip; empty string for a still"),
  negative: z
    .string()
    .max(600)
    .describe(
      "a concise comma-separated list of things to AVOID in this render (artifacts, off-brand elements, anything the guardrails forbid). Used as the video negative prompt.",
    ),
  aspect_ratio: z.string().describe("e.g. 9:16, 1:1, 16:9"),
  duration_seconds: z
    .number()
    .describe("clip length in seconds; 0 for a static still"),
  caption: z.string().max(600).describe("on-screen or post caption text for this shot"),
  voiceover: z
    .string()
    .max(600)
    .describe(
      "For a cinematic reel ONLY: the spoken narration line for this shot (empty string otherwise). ONE natural sentence within the clip's word budget (~2.7 words per second × duration_seconds). Conversational, on-brand, no hashtags/emojis.",
    ),
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

// Tolerant parse for STORED briefs: fills fields added after a brief was saved
// (e.g. `negative`) so older briefs still load instead of vanishing. The OpenAI
// call keeps the strict schema; this is only for reading what's already in the DB.
export function parseBrief(content: string | null): Brief | null {
  let obj: unknown;
  try {
    obj = JSON.parse(content || "null");
  } catch {
    return null;
  }
  if (obj && typeof obj === "object" && Array.isArray((obj as { shots?: unknown }).shots)) {
    const o = obj as { shots: Array<Record<string, unknown>> };
    o.shots = o.shots.map((s) => ({ motion: "", negative: "", voiceover: "", ...s }));
  }
  const r = BriefSchema.safeParse(obj);
  return r.success ? r.data : null;
}

// ── Funnel goals ─────────────────────────────────────────────────────
// The user picks WHY the creative exists; the prompt engineer curates and
// writes for that stage. Guardrail-aware (never discounts / medical claims).

export const FUNNEL_GOAL_GUIDANCE: Record<string, { label: string; guidance: string; pacing: string }> = {
  awareness: {
    label: "Brand awareness",
    guidance:
      "This creative must reach people who do NOT know the clinic yet. Hook emotionally within the FIRST 2 seconds, lead with warm human lifestyle moments over clinical detail, keep energy confident and optimistic, close on the brand mark. NO booking pressure, no hard CTA — the only job is to be remembered and liked.",
    pacing: "fast, confident cuts — hold each image 1.5–2.2s; total 12–22s",
  },
  consideration: {
    label: "Consideration",
    guidance:
      "The viewer already knows the clinic exists and is weighing options. Build TRUST: the team's warmth and expertise, the calm premium space, quality-of-care cues, real-patient comfort. Reassuring, unhurried tone. Close with a soft invitation ('get to know us', 'meet the team') — informative, never pushy.",
    pacing: "calm, steady — hold each image 2.2–3.0s; total 18–30s",
  },
  conversion: {
    label: "Conversion",
    guidance:
      "The viewer is ready to act. Be benefit-forward and specific about what they get, confident and direct while honoring every guardrail (no discounts, no medical-outcome claims). Build to a clear closing call-to-action to BOOK — the end-card carries the brand and the ask; use the clinic boilerplate for contact context.",
    pacing: "deliberate — hold each image 2.5–3.5s, strongest proof last before the CTA end-card; total 15–28s",
  },
};

// ── Prompt-engineer system message ───────────────────────────────────
// Turns a short human direction + the full brand context into a system prompt
// that makes gpt-4o write PRODUCTION-GRADE renderer prompts (not concept notes).
// The brand palette, voice, CEO directives and creative guidelines are folded
// into every shot prompt here — that's what makes the output usable and on-brand.
export function briefSystemPrompt(
  job: Job,
  block: string,
  directorBrief: string,
  inspiration: Asset[] = [],
  sourceImageCount = 0,
): string {
  const isOptimize = job.intent === "optimize";
  const isVideo = job.media === "video";
  const isMontage = isMontageJob(job);
  const isReel = isReelJob(job);
  const goal = job.funnel_goal ? FUNNEL_GOAL_GUIDANCE[job.funnel_goal] : undefined;
  const renderer = isMontage
    ? "a deterministic pan/zoom montage engine (uses the real photos as-is)"
    : isReel
      ? "Kling clips stitched into ONE cinematic reel (kinetic captions + AI voiceover + music + CTA end-card)"
      : isVideo
        ? "Kling (image-to-video)"
        : isOptimize
          ? "FLUX Kontext (edits a real photo)"
          : "FLUX (text-to-image)";
  // With few photos, use them all; with many, curate down to the strongest.
  const montageUse =
    sourceImageCount > 0 && sourceImageCount <= 4
      ? `all ${sourceImageCount} attached photo(s)`
      : `4 to ${Math.min(Math.max(sourceImageCount, 4), 10)} of the attached photos`;
  const carouselN = clampCarousel(job.carousel_count);
  const shotCount = isMontage
    ? `one shot per SELECTED photo (${montageUse})`
    : isOptimize
      ? "exactly 1 shot"
      : isReel && sourceImageCount > 0
        ? `one shot per SELECTED real photo — the beats of ONE cinematic reel built from the user's real photos (hook → build → payoff)`
        : isReel
        ? `exactly ${reelShotCount(job)} shots — the sequential beats of ONE cinematic reel: open on a scroll-stopping hook, build with proof/benefit, close on the payoff. Each shot is a distinct cinematic scene that SHARES ONE consistent visual look`
        : carouselN > 1
          ? `exactly ${carouselN} shots — these are the ${carouselN} slides of ONE carousel post: a cohesive set (consistent style, lighting and palette) that flows slide-to-slide (open with a hook, build in the middle, end with a soft call-to-action). Each slide must be visually distinct`
          : "exactly 1 shot";

  return [
    `You are a world-class AI image & video PROMPT ENGINEER and the creative director for ${job.title ? "this" : "a"} premium dental brand. You turn a short human direction into production-grade generation prompts that the fal.ai renderer (${renderer}) renders into POLISHED, ON-BRAND, USABLE marketing creatives. Weak, generic prompts are unacceptable — be specific and cinematic.`,
    "",
    block,
    "",
    ...(directorBrief
      ? [
          "# Creative director brief (uploaded PDF) — PRIMARY DIRECTION",
          "Lead with this; every shot must realize it while honoring the guardrails above.",
          directorBrief.slice(0, 12000),
          "",
        ]
      : []),
    ...(goal
      ? [
          `# FUNNEL GOAL: ${goal.label}`,
          goal.guidance,
          "",
        ]
      : []),
    `# VISUAL STYLE: ${styleLabel(job.style)}`,
    styleGuidance(job.style),
    "Apply this style consistently across every shot while staying on-brand.",
    ...(isReel && (job.reel_style ?? "auto") !== "auto"
      ? [
          "",
          `# REEL HOUSE STYLE: ${reelStyle(job.reel_style).label}`,
          reelStyle(job.reel_style).promptGuidance,
          "The finished reel is graded and typeset to this style — write imagery that suits it.",
        ]
      : []),
    "",
    ...(inspiration.length
      ? [
          "# INSPIRATION REFERENCES — the user attached example creative(s) showing the LOOK they want (you can SEE them in this conversation).",
          "Study each reference and fold its aesthetic into every shot.prompt: name its color grade, lighting, composition, texture and mood CONCRETELY in your prompt words (the renderer also receives the reference images themselves).",
          ...inspiration.map(
            (a, i) => `- Reference ${i + 1} [#${a.id}]: borrow ${a.notes?.trim() || "its overall look — color grade, lighting, composition, mood"}.`,
          ),
          "References define STYLE ONLY — never copy their people, products, scenes, text, or logos. The user's own photo/direction defines the content.",
          "If a reference conflicts with the brand palette, CEO directives or guardrails, the brand wins.",
          "",
        ]
      : []),
    ...(isMontage
      ? [
          "# THIS IS A PHOTO-MONTAGE VIDEO (a CURATION job, not a render-prompt job)",
          "The user's real photos are used AS-IS — nothing is generated. You are the editor: the photos you may use are ATTACHED to this conversation, and the user message lists exactly which ids are valid. Your whole job:",
          `- SELECT the strongest photos for the goal${goal ? ` (${goal.label})` : ""} — drop weak, blurry, near-duplicate or off-brand ones. Use ${montageUse}.`,
          "- ORDER them as a narrative: the most arresting image FIRST as the hook, proof and warmth in the middle, the strongest closer last.",
          "- For each selected photo return one shot with: source_asset_id = that photo's id (ONLY ids from the attached-photos list, each id used at most ONCE, never null); duration_seconds = its hold time; motion = exactly one of: zoom-in, zoom-out, pan-left, pan-right (vary them — never the same move twice in a row); prompt = ONE short line saying why this image sits here and what the viewer should feel (NOT a render prompt); caption = a short on-screen text suggestion for the editor; negative = \"\".",
          "- Set mode = \"dynamic\" for this brief.",
          `- PACING: ${goal ? goal.pacing : "hold each image 2–3s; total 15–30s"}. A brand end-card is appended automatically after your last shot.`,
          "- assembly_instructions = the opening hook line, the end-card message, music mood, and the CTA (matched to the goal). post_caption = the post copy for this goal.",
          "",
        ]
      : []),
    ...(isMontage
      ? []
      : [
    "# HOW TO WRITE EACH shot.prompt (this is the whole job)",
    "Write each prompt as ONE vivid, self-contained paragraph (45-120 words) that nails:",
    "- SUBJECT & wardrobe: real, relatable, diverse people with genuine warm expressions; for dental, clean NATURAL smiles — never exaggerated or unnaturally white teeth.",
    "- SETTING: a modern, bright, calming, premium space (clinic, reception, lifestyle) — never sterile or clinical-scary.",
    "- COMPOSITION: clear focal point, rule of thirds, calm negative space (so a caption + corner logo can be added later).",
    "- LIGHTING: soft natural daylight, gentle key light, airy and editorial.",
    "- LENS/CAMERA: be specific (e.g. 85mm portrait, shallow depth of field; or a wide establishing shot).",
    "- COLOR GRADE: pull the brand palette HEX codes above into the lighting/wardrobe/props (navy, mint, teal, off-white tones).",
    "- MOOD: match the brand voice above — calm, premium, trustworthy, reassuring. NEVER hype, salesy, or discount-y.",
    "- REALISM: end with cues like 'photorealistic, ultra-detailed, professional photography, natural skin texture, crisp focus'.",
    "- AVOID (state what to keep out): NO logos, brand marks, badges, embroidery, signage, watermarks, or ANY readable text/words/numbers in the frame — the model only produces garbled fakes, and the REAL logo is composited afterwards. Drop any 'put the logo on it' request from the direction. Also: no medical claims or before/after, no distorted hands or teeth, no stocky/plastic/CGI look, nothing in the hard-guardrail list. Keep wardrobe a plain UNBRANDED clean coat/scrubs.",
    "",
    isOptimize
      ? [
          "# THIS IS AN EDIT (optimize)",
          "The renderer EDITS the user's REAL uploaded photo(s). PRESERVE the real person, identity, scene and product — ENHANCE, don't replace. Describe the desired end-state of the SAME photo: fix exposure/white-balance/lighting, declutter and soften the background, lift it to the brand color grade and a premium editorial finish, sharpen, remove distractions. Do NOT invent a brand-new scene. Return exactly 1 shot whose prompt is this edit instruction (it is applied to each uploaded photo).",
        ].join("\n")
      : [
          "# THIS IS NET-NEW (create)",
          "Generate fresh imagery from the direction. Return 1-4 distinct, strong shots that together cover the idea.",
        ].join("\n"),
    "",
    isReel && sourceImageCount > 0
      ? [
          "# CINEMATIC REEL FROM THE USER'S REAL PHOTOS (best-quality path)",
          "The user attached REAL photos (their actual doctors / clinic — you can SEE them above). Build the reel FROM these real photos. This is the PREFERRED, most realistic path: the real people, faces, uniforms and REAL logo are preserved exactly — never invent or describe a new AI scene.",
          `Choose the strongest photos and return ONE shot PER chosen photo (${Math.min(sourceImageCount, reelShotCount(job))}–${Math.min(Math.max(sourceImageCount, 3), 6)} shots), ordered as a narrative: most arresting FIRST (hook), warmth/proof in the middle, strongest closer last.`,
          "For EACH shot return:",
          "- source_asset_id = the id of that real photo (ONLY ids from the attached list; each id used at most ONCE; never null).",
          "- prompt = a SHORT preservation instruction (NOT a new scene): e.g. \"Preserve the real person, face, uniform, real logo and setting EXACTLY; add only a slow, subtle cinematic push-in. No new elements, no scene change, no added or altered text, no extra people.\"",
          "- motion = a gentle move (slow push-in or soft pan).",
          "- caption = a SHORT kinetic on-screen line for this beat (≤ 6 words, editorial, no hashtags/emoji).",
          "- voiceover = ONE natural spoken sentence for this beat (~13 words); read in order the voiceovers flow as ONE continuous narration (hook → build → payoff).",
          "- negative = \"changing the person, altering the face or identity, morphing, distortion, added or altered text, extra people, warping the uniform\" plus the baseline.",
          "- duration_seconds = 5.",
          "Set mode = \"dynamic\". Captions, voiceover, music and the brand CTA card are composited by the app on top of the real footage — do NOT bake any of them into a shot.",
        ].join("\n")
      : isReel
      ? [
          "# CINEMATIC REEL SHOTS (generated — no real photos were uploaded)",
          "NOTE: for the MOST realistic reel, the user can upload real photos of their own doctors/clinic and we animate those instead. With none attached, generate the scenes as below.",
          `⛔ YOU MUST RETURN EXACTLY ${reelShotCount(job)} SHOTS — one per beat. Returning fewer is a FAILURE. Even if the direction describes "a clip" / "a 5-second clip" / a single moment, EXPAND it into ${reelShotCount(job)} distinct sequential beats (different framings/moments of the same story). Never collapse the reel to one shot.`,
          "Each shot is ONE 5s Kling clip; the shots are CONCATENATED into a single reel. A brand CTA end-card is appended automatically — do NOT create a shot for it.",
          "",
          "## HARD RULE — NO LOGOS OR TEXT IN THE FRAME (this is the #1 quality killer)",
          "The image model CANNOT render a real brand logo or readable text — it produces garbled fake marks and misspelled words that look amateur and differ every shot. So:",
          "- NEVER write 'logo', 'branded uniform', 'Dental Nation logo', a brand name on a wall/sign/coat, or ANY on-frame text/words/numbers into a shot.prompt — EVEN IF THE USER'S DIRECTION EXPLICITLY ASKS FOR IT. Silently drop that request.",
          "- Wardrobe is a PLAIN, clean, unbranded white coat / scrubs — no embroidery, no badge, no chest logo, no lanyard text.",
          "- The REAL brand logo is composited by the app afterwards (a crisp corner watermark + the closing card) — that is the ONLY correct way the mark appears. Your job is clean, textless footage.",
          "- Put 'text, words, letters, logos, badges, brand marks, watermark, signage, embroidery, numbers' in every shot's `negative`.",
          "",
          "## ONE CONSISTENT HERO (cohesion of PERSON, not just palette)",
          "In `concept`, cast ONE specific protagonist and describe them precisely: gender, apparent age, ethnicity, hair (style + colour), build, exact wardrobe. Then in EVERY shot that shows a person, describe THAT SAME PERSON with the identical wording so it reads as one human across the reel — never a different face each beat. (If a shot has no person, it's a detail/environment shot — see below.)",
          "",
          "## VARY THE SHOT TYPES (a reel is not 4 headshots)",
          `Across the ${reelShotCount(job)} shots, deliberately mix framings like a real film — do NOT repeat the same smiling head-and-shoulders portrait. Use a spread such as: a WIDE establishing shot of the clinic; a MEDIUM of the hero at work; a tight DETAIL/macro (hands, a tool on a tray, a genuine smile close-up, light through a window); a warm INTERACTION (hero greeting a patient). Open on the most arresting frame.`,
          "",
          "For EACH shot return:",
          "- prompt: the OPENING FRAME described richly (the model animates from it), 45-120 words, TEXTLESS and LOGO-FREE, restating the hero + the look-anchor.",
          "- motion: a premium, gentle camera move (slow push-in, soft pan, subtle parallax) + natural subject motion.",
          "- caption: a SHORT kinetic on-screen line — the words the viewer READS on this beat (≤ 6 words, editorial, no hashtags/emoji).",
          "- voiceover: ONE natural spoken sentence for this beat within the word budget (~13 words for a 5s clip). Read in order, the voiceover lines must flow as ONE continuous narration (hook → build → payoff).",
          "- duration_seconds = 5.",
          "COHESION: define ONE look (color grade / lighting / location) in `concept` and restate that SAME look-anchor sentence inside EVERY shot.prompt so the independently-generated clips feel like one film.",
          "Set mode = \"dynamic\".",
        ].join("\n")
      : isVideo
        ? "# VIDEO\nEach shot is ONE ~5s Kling clip. Describe the OPENING FRAME richly (the model animates from it) and set `motion` to a premium, gentle camera move (slow push-in, soft pan, subtle parallax) plus natural subject motion. duration_seconds = 5."
        : "# STILLS\nEach shot is one still image. motion = \"\", duration_seconds = 0.",
    "",
      ]),
    "# NON-NEGOTIABLE",
    `- Honor EVERY CEO directive and creative guideline above — they outrank your own taste.`,
    "- Respect every hard guardrail. No medical-outcome claims, ever.",
    isMontage
      ? "- Every shot's source_asset_id MUST be one of the listed source photo ids; motion MUST be one of zoom-in | zoom-out | pan-left | pan-right."
      : isReel && sourceImageCount > 0
        ? "- Every shot's source_asset_id MUST be one of the listed REAL photo ids (each used at most once, never null) — the reel is built from those real photos."
        : isOptimize
          ? "- Reference each source asset id in source_asset_id."
          : "- source_asset_id = null (text-to-image).",
    ...(isMontage
      ? []
      : [
          `- Set each shot's \`negative\` to a concise avoid-list that EXTENDS this baseline${isReel ? " AND MUST include: on-screen text, captions, subtitles, words, letters, watermark, logos (captions are burned in later, so the AI frame must be TEXTLESS)" : ""} (add anything specific to the brief/guardrails): ${BASE_NEGATIVE}`,
        ]),
    "",
    `Return ${shotCount} in the structured brief. concept = one line on the idea. post_caption = a short on-brand caption (no discounts/claims). assembly_instructions = how to finish (corner logo, caption, music mood).`,
  ].join("\n");
}
