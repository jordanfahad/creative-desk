// Per-designer briefs shown at /download-jobs/<slug>.
// Kept in the repo (not the DB) deliberately: a brief is a versioned artefact —
// it should be reviewable in a diff and travel with the deploy that created it.
// (The 3-day trial sprint this page previously carried lives in git history.)
//
// VOLUME MODEL. Work only scales as a SYSTEM, not as dozens of unrelated
// ideas: a small number of MASTERS (designed from scratch) and many VARIANTS
// derived from them (per clinic, per offer, per language, per cutdown, per
// placement). Totals are computed from the concept list, so the page always
// reflects the actual brief rather than a number someone typed.

export type Tier = "master" | "variant";

export interface BriefConcept {
  ref: string;
  kind: "video" | "static" | "gbp" | "pmax";
  tier: Tier;
  title: string;
  note: string;
  /** how many deliverables this line represents (variants collapse into one row) */
  count: number;
}
export interface BriefLane {
  key: string;
  name: string;
  offer: string;
  landing: string;
  priority: string;
  direction: string;
  concepts: BriefConcept[];
}
export interface DesignerBrief {
  slug: string;
  name: string;
  /** Page heading suffix, e.g. "creative sprint" or "BAU creative brief". */
  role: string;
  dates: string;
  channels: string;
  bias: string;
  uploadPrefix: string;
  clinics: string[];
  /** Kit is split across two sites — worth knowing before a shoot day. */
  equipment: Array<{ item: string; location: string; note: string }>;
  /** The one instruction that outranks the rest, shown first. */
  startHere: { title: string; body: string };
  intro: string[];
  lanes: BriefLane[];
  specs: string[];
  rules: string[];
  schedule: Array<{ day: string; focus: string; target: string }>;
  done: string[];
  reference: string[];
}

const CLINICS = ["Dental Nation Al Wasl", "Dr Tosun Dental Clinic", "Al Maher Clinic"];

/**
 * A BAU LAUNCH lane: everything one offer needs to go live on organic, paid
 * social AND Google Performance Max at the same time. Same shape per lane so
 * the system is learnable in one pass:
 *   2 video masters + 4 derivative cuts · 2 static masters + 6 variants ·
 *   1 GBP post per clinic · the full PMax asset group (8 images + 3 videos).
 */
function launchLane(
  key: string,
  name: string,
  offer: string,
  landing: string,
  priority: string,
  direction: string,
  heroes: Array<[string, string]>,
  variantNotes: { video: string; static: string },
): BriefLane {
  const concepts: BriefConcept[] = [];
  heroes.forEach(([title, note], i) => {
    concepts.push({ ref: `${key}-V${i + 1}`, kind: "video", tier: "master", title, note, count: 1 });
  });
  concepts.push({
    ref: `${key}-Vx`,
    kind: "video",
    tier: "variant",
    title: `${6 - heroes.length} derivative cuts`,
    note: variantNotes.video,
    count: 6 - heroes.length,
  });
  concepts.push({
    ref: `${key}-S1`,
    kind: "static",
    tier: "master",
    title: "Key visual — master layout",
    note: "Price-forward. This is the template every variant is built from.",
    count: 1,
  });
  concepts.push({
    ref: `${key}-S2`,
    kind: "static",
    tier: "master",
    title: "Second master — alternate angle",
    note: "A genuinely different composition, not a recolour.",
    count: 1,
  });
  concepts.push({
    ref: `${key}-Sx`,
    kind: "static",
    tier: "variant",
    title: "6 variants from the two masters",
    note: variantNotes.static,
    count: 6,
  });
  concepts.push({
    ref: `${key}-G`,
    kind: "gbp",
    tier: "variant",
    title: "GBP post × 3 clinics",
    note: "One per clinic — clinic name, address line and its own booking action.",
    count: 3,
  });
  // Google Performance Max asset group. Without a complete set the campaign
  // either cannot serve or Google auto-generates the gaps (badly) — so the
  // asset group is a DELIVERABLE, not an export.
  concepts.push({
    ref: `${key}-P1`,
    kind: "pmax",
    tier: "variant",
    title: "PMax image set — 3 landscape · 3 square · 2 portrait",
    note:
      "Derived from the static masters, but CLEAN: no price/CTA text baked in (Google crops freely and overlays its own text). 1200×628, 1200×1200, 960×1200.",
    count: 8,
  });
  concepts.push({
    ref: `${key}-P2`,
    kind: "pmax",
    tier: "variant",
    title: "PMax video trio — 16:9 · 9:16 · 1:1, each ≥10s",
    note: "Cutdowns of the lane's video masters. If we don't supply these, Google auto-generates them from stills — always supply.",
    count: 3,
  });
  return { key, name, offer, landing, priority, direction, concepts };
}

const HASHID: DesignerBrief = {
  slug: "hashid",
  name: "Hashid",
  role: "BAU creative brief",
  dates: "From 2 August 2026 — ongoing (weekly drops)",
  channels: "Social organic · Paid social (Meta) · Paid search (Google Performance Max) · GBP",
  bias: "Launch-first: Lanes E, B and D ship together",
  uploadPrefix: "deliveries/Hashid_BAU_2026-08",
  clinics: CLINICS,
  equipment: [
    {
      item: "Camera",
      location: "Dental Nation Al Wasl — Vital room",
      note: "Collect it yourself; no need to arrange handover.",
    },
    {
      item: "Lights and tripod",
      location: "Al Maher Clinic",
      note: "Held at a different site to the camera — pick both up before a shoot day rather than mid-session.",
    },
  ],
  startHere: {
    title: "Trial cleared — welcome aboard. First job: the E · B · D launch set.",
    body:
      "The sprint is done and you're through the interview — this page is now your standing BAU brief. Three offers launch SIMULTANEOUSLY: Lane E (Glow Up), Lane B (First Look) and Lane D (SOS), each across organic, paid social and Google Performance Max. Paid comes first: neither Meta nor PMax can go live until a lane's full asset set exists, so the launch set outranks everything else. Reuse your sprint footage wherever it serves — reshoot only what's missing — and keep the sprint rule: anything that needs clinic access gets filmed early, everything else is desk work.",
  },
  intro: [
    "Work as a SYSTEM, not as a list of unrelated ideas. Per launch lane: 2 video masters + 4 derivative cuts, 2 static masters + 6 variants, 1 GBP post per clinic, and the full PMax asset group (8 clean images + 3 video cutdowns). A derivative is a hook swap, a clinic-tagged version, a cutdown or an Arabic version — not a new idea from scratch.",
    "Ratio crops (9:16 / 1:1 / 4:5) are exports, not deliverables — they are expected with every concept and are not counted. The PMax set is the exception: it IS counted, because a campaign cannot serve without it.",
    "Every OFFER deliverable must state the offer, the price and one clear action. Paid leads convert badly when the click was misled — creative should QUALIFY rather than maximise clicks: be explicit about what the offer is, what it costs and which clinic it is at. PMax images are the one place price text does NOT belong (Google overlays its own).",
    "After the launch set ships, the standing rhythm is Lane A: the weekly organic engine — at least 5 organic posts a week across the clinics' channels, fed from your masters, derivatives and AI stack.",
  ],
  lanes: [
    launchLane(
      "E", "Glow Up (whitening)", "The DN Glow Up — from AED 1,699",
      "https://www.dentalnation.com/en/glow-up", "Launch — paid + organic + PMax",
      "Highest-value offer. Lead with the visible outcome.",
      [
        ["Before/after transformation", "Close-up, natural light. The result is the hook. Sprint footage covers this — recut, don't reshoot."],
        ["What actually happens in a Glow Up", "The session step by step — demystifies and reassures."],
      ],
      {
        video: "Couples angle (AED 2,999), 15s cutdown of each master, one clinic-tagged version per clinic, and an Arabic caption version.",
        static: "One per clinic, a couples-offer version, a price-anchor version and an Arabic version.",
      },
    ),
    launchLane(
      "B", "First Look (new patient)", "The DN First Look — from AED 799",
      "https://www.dentalnation.com/en/first-look", "Launch — paid + organic + PMax",
      "The welcome offer, promoted properly for the first time. Warm, low-anxiety — this is most people's first ad from us, so it sets the tone.",
      [
        ["First visit walkthrough", "What to expect — anxiety-reducing."],
        ["What's included at AED 799", "Itemised, concrete."],
      ],
      {
        video: "Nervous-patient angle, 15s cutdowns, clinic-tagged versions, Arabic version.",
        static: "Welcome visual per clinic, what's-included version, Arabic version.",
      },
    ),
    launchLane(
      "D", "SOS (emergency)", "DN SOS — Seen in 60 — from AED 699",
      "https://www.dentalnation.com/en/sos", "Launch — paid + organic + PMax",
      "Urgency and reassurance. Same-day care is the hook.",
      [
        ["“Seen in 60” — the promise", "Timer-led and unambiguous."],
        ["Pain-relief reassurance", "Calm tone — what to do right now."],
      ],
      {
        video: "After-hours/weekend version, 15s cutdowns, a clinic-tagged version per clinic, Arabic version.",
        static: "Emergency card per clinic (phone + WhatsApp prominent), after-hours version, Arabic version.",
      },
    ),
    // The ongoing organic engine sits OUTSIDE the offer system: no price, no
    // lane template. Its job is reach and shares — and it feeds the ≥5
    // posts/week organic cadence that continues every week after launch.
    {
      key: "A",
      name: "Organic BAU — brand awareness & weekly cadence",
      offer: "No price, no hard CTA — Dental Nation (Al Wasl, main branch)",
      landing: "https://www.dentalnation.com/en",
      priority: "Ongoing — ≥5 organic posts/week",
      direction:
        "Trend-native, scroll-stopping, made to be SENT to a friend. No offer, no price, no hard sell. Generate freely with your own AI stack (Seedance, Higgsfield, etc.); brand-safe means no medical claims, no before/after promises, no unnatural teeth. Close on the brand mark only. This lane never ends: it is the weekly posting engine.",
      concepts: [
        {
          ref: "A-V1",
          kind: "video",
          tier: "master",
          title: "ASMR / satisfying macro",
          note: "Extreme close-ups, glossy textures, no talking — built for sound-on and for looping. The DN SOS macro stills register (tooth-in-locket, egg-crack, candle) is the reference.",
          count: 1,
        },
        {
          ref: "A-V2",
          kind: "video",
          tier: "master",
          title: "POV / relatable trend format",
          note: "\"POV: you finally stopped hiding your smile.\" Ride a current audio and cut pattern — the share is the goal, so it must land in the first 2 seconds.",
          count: 1,
        },
        {
          ref: "A-V3",
          kind: "video",
          tier: "master",
          title: "Surreal brand film",
          note: "One striking visual metaphor for confidence, cinematic and strange enough to stop a scroll. Hero piece — the brand's calling card.",
          count: 1,
        },
        {
          ref: "A-Wk",
          kind: "video",
          tier: "variant",
          title: "Weekly cadence — first fortnight's reels",
          note: "First two weeks of the standing ≥5 posts/week rhythm: trend rides, clinic moments, cutdowns of the launch masters. Volume shown here is the first drop only — the cadence continues every week.",
          count: 4,
        },
      ],
    },
  ],
  specs: [
    "VIDEO — deliver each as 9:16 (1080×1920, master) + 1:1 (1080×1080) + 4:5 (1080×1350)",
    "STATIC — deliver as 1:1, 4:5 and 1200×628",
    "GBP — 1200×900 (4:3) plus a 1:1 crop",
    "PMAX images — 1.91:1 (1200×628) ×3 · 1:1 (1200×1200) ×3 · 4:5 (960×1200) ×2 per lane, CLEAN (no baked-in price/CTA text; Google crops and overlays its own). Logo is in the kit.",
    "PMAX video — 16:9, 9:16 and 1:1, each at least 10 seconds, per lane",
  ],
  rules: [
    "Burned-in captions on EVERY social video — most views are muted (PMax cutdowns too)",
    "Music must be licensed for PAID use — platform/in-app library tracks cannot be used in ads",
    "Every clinic-tagged deliverable names the clinic it is for — this is the qualification lever",
    "Keep logo, price and CTA inside the safe areas on every crop",
    "PMax images ship CLEAN — the priced version is for Meta/organic; the clean version is for PMax. Two exports, one design.",
    "Deliver source masters (project files + fonts + music licences) in _source/",
    "Brand kit, logos, characters and clinic photography are on the main Jobs Pack page — reuse them rather than sourcing stock",
    "Generate freely with your own AI stack — especially for Lane A. Brand-safe means no medical claims, no before/after promises, no unnaturally white teeth, and the real logo only (never an AI-drawn one)",
  ],
  schedule: [
    {
      day: "Week 1 — 2–8 Aug",
      focus:
        "THE LAUNCH SET. Lanes E, B and D complete: paid social + PMax asset groups first (nothing can go live without them), then statics and GBP. Any missing footage gets shot early in the week while clinic access is easy.",
      target: "E · B · D asset sets delivered — campaigns can launch",
    },
    {
      day: "Week 2 — 9–15 Aug",
      focus:
        "Organic engine on. Lane A masters + the weekly cadence starts (≥5 posts/week). First performance read on the launch lanes → refresh the weakest paid variant per lane.",
      target: "Cadence running · first variant refresh",
    },
    {
      day: "Ongoing — every week",
      focus:
        "≥5 organic posts across channels · refresh the worst-performing paid variant per live lane · monthly GBP refresh per clinic. Weekly drop lands every Friday in the delivery folders below.",
      target: "Friday drops, every week",
    },
  ],
  done: [
    "Every launch lane's PMax asset group is COMPLETE: 3 landscape + 3 square + 2 portrait clean images, 3 videos ≥10s — no gaps for Google to auto-fill",
    "All social crops exported and readable in each",
    "Captions burned in and correct",
    "Music cleared for paid use",
    "Price, offer, clinic and CTA legible on mobile (social versions); PMax versions clean of baked-in text",
    "Files follow the naming convention and sit in the right lane folder",
    "Source masters included in _source/",
  ],
  reference: [
    "Live offers — https://www.dentalnation.com/en (Signature offers section)",
    "Launch landing pages — /en/glow-up · /en/first-look · /en/sos",
    `Clinics — ${CLINICS.join(" · ")}`,
    "Phone — +971 55 277 2311 (WhatsApp available)",
    "Brand kit, founder briefs, logos and guidelines — on the main Jobs Pack page",
  ],
};

export const DESIGNER_BRIEFS: DesignerBrief[] = [HASHID];

export function designerBrief(slug: string): DesignerBrief | undefined {
  const s = slug.trim().toLowerCase();
  return DESIGNER_BRIEFS.find((b) => b.slug === s);
}

export function briefTotals(b: DesignerBrief) {
  const all = b.lanes.flatMap((l) => l.concepts);
  const sum = (k: string) => all.filter((c) => c.kind === k).reduce((n, c) => n + c.count, 0);
  return {
    total: all.reduce((n, c) => n + c.count, 0),
    video: sum("video"),
    static: sum("static"),
    gbp: sum("gbp"),
    pmax: sum("pmax"),
    masters: all.filter((c) => c.tier === "master").reduce((n, c) => n + c.count, 0),
    variants: all.filter((c) => c.tier === "variant").reduce((n, c) => n + c.count, 0),
  };
}
