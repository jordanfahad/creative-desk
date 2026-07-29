// Per-designer sprint briefs shown at /download-jobs/<slug>.
// Kept in the repo (not the DB) deliberately: a brief is a versioned artefact —
// it should be reviewable in a diff and travel with the deploy that created it.
//
// VOLUME MODEL. A sprint this size only works as a SYSTEM, not as dozens of
// unrelated ideas: a small number of MASTERS (designed from scratch) and many
// VARIANTS derived from them (per clinic, per offer, per language, per cutdown).
// Totals are computed from the concept list, so the page always reflects the
// actual brief rather than a number someone typed.

export type Tier = "master" | "variant";

export interface BriefConcept {
  ref: string;
  kind: "video" | "static" | "gbp";
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
  dates: string;
  channels: string;
  bias: string;
  uploadPrefix: string;
  clinics: string[];
  /** Kit is split across two sites — worth knowing before a shoot day. */
  equipment: Array<{ item: string; location: string; note: string }>;
  intro: string[];
  lanes: BriefLane[];
  specs: string[];
  rules: string[];
  schedule: Array<{ day: string; focus: string; target: string }>;
  done: string[];
  reference: string[];
}

const CLINICS = ["Dental Nation Al Wasl", "Dr Tosun Dental Clinic", "Al Maher Clinic"];

/** Every lane follows the same shape, so the system is learnable in one pass. */
function lane(
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
  return { key, name, offer, landing, priority, direction, concepts };
}

const HASHID: DesignerBrief = {
  slug: "hashid",
  name: "Hashid",
  dates: "28–30 July 2026 (3 days)",
  channels: "Social organic · Social paid · Google Business Profile",
  bias: "Video-heavy",
  uploadPrefix: "deliveries/Hashid_2026-07-28",
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
  intro: [
    "Work as a SYSTEM, not as a list of unrelated ideas. Build a small number of MASTERS properly, then derive the rest: per lane, 2 video masters + 4 derivative cuts, 2 static masters + 6 variants, and 1 GBP post per clinic. A derivative is a hook swap, a clinic-tagged version, a cutdown or an Arabic version — not a new idea from scratch.",
    "Ratio crops (9:16 / 1:1 / 4:5) are exports, not deliverables — they are expected with every concept and are not counted.",
    "Every OFFER deliverable must state the offer, the price and one clear action. Recent paid leads converted badly — many were wrong or unreachable contacts — so creative should QUALIFY rather than maximise clicks: be explicit about what the offer is, what it costs and which clinic it is at.",
    "Lanes are ordered by live paid spend: E, D and J carry the ArabyAds campaign and come first. C and B support them. Lane A (brand awareness) is separate — it carries no price and exists to be shared.",
  ],
  lanes: [
    // Brand awareness sits OUTSIDE the offer system: no price, no lane template.
    // Its whole job is to be shared — DM shares are the number one Instagram
    // ranking signal, and a share reaches people paid never touches.
    {
      key: "A",
      name: "Brand awareness — viral / trending",
      offer: "No price, no hard CTA — Dental Nation (Al Wasl, main branch)",
      landing: "https://www.dentalnation.com/en",
      priority: "Organic — reach & shares",
      direction:
        "Trend-native, scroll-stopping, made to be SENT to a friend. No offer, no price, no hard sell — just the brand being worth watching. Generate freely with your own AI stack (Seedance, Higgsfield, etc.); brand-safe means no medical claims, no before/after promises, no unnatural teeth. Close on the brand mark only.",
      concepts: [
        {
          ref: "A-V1",
          kind: "video",
          tier: "master",
          title: "ASMR / satisfying macro",
          note: "Extreme close-ups, glossy textures, no talking — built for sound-on and for looping. The existing DN SOS macro stills (tooth-in-locket, egg-crack, candle) are exactly this register and are in the pack.",
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
          note: "One striking visual metaphor for confidence, cinematic and strange enough to stop a scroll. Hero piece — treat it as the brand's calling card.",
          count: 1,
        },
      ],
    },
    lane(
      "E", "Glow Up (whitening)", "The DN Glow Up — from AED 1,699",
      "https://www.dentalnation.com/en/glow-up", "Paid — highest value",
      "Highest-value offer. Lead with the visible outcome.",
      [
        ["Before/after transformation", "Close-up, natural light. The result is the hook."],
        ["What actually happens in a Glow Up", "The session step by step — demystifies and reassures."],
      ],
      {
        video: "Couples angle (AED 2,999), 15s cutdown of each master, one clinic-tagged version per clinic, and an Arabic caption version.",
        static: "One per clinic, a couples-offer version, a price-anchor version and an Arabic version.",
      },
    ),
    lane(
      "D", "SOS (emergency)", "DN SOS — Seen in 60 — from AED 699",
      "https://www.dentalnation.com/en/sos", "Paid",
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
    lane(
      "J", "Scan (orthodontics)", "The DN Scan — from AED 499",
      "https://www.dentalnation.com/en/scan", "Paid",
      "Low-commitment entry point. Curiosity-led.",
      [
        ["What the scan shows you", "Screen-capture feel."],
        ["“Am I a candidate for aligners?”", "Quick-answer format."],
      ],
      {
        video: "Price-anchored cut (AED 499 vs doing nothing), 15s cutdowns, clinic-tagged versions, Arabic version.",
        static: "Scan visual per clinic, price-anchor version, candidate-check version, Arabic version.",
      },
    ),
    lane(
      "C", "Restore (implants / restorative)", "The DN Plan — complimentary (valued AED 899)",
      "https://www.dentalnation.com/en/care-journeys/restore", "Organic / supporting",
      "Higher consideration. Trust and expertise over urgency.",
      [
        ["The DN Plan explained", "What a complimentary consult includes."],
        ["Restorative journey", "Patient-story framing."],
      ],
      {
        video: "Doctor-led credibility cut, 15s cutdowns, clinic-tagged versions, Arabic version.",
        static: "Plan-value visual per clinic, doctor-credibility version, Arabic version.",
      },
    ),
    lane(
      "B", "First Look (new patient)", "The DN First Look — from AED 799",
      "https://www.dentalnation.com/en/first-look", "Organic / supporting",
      "Welcome offer. Warm, low-anxiety.",
      [
        ["First visit walkthrough", "What to expect — anxiety-reducing."],
        ["What's included at AED 799", "Itemised, concrete."],
      ],
      {
        video: "Nervous-patient angle, 15s cutdowns, clinic-tagged versions, Arabic version.",
        static: "Welcome visual per clinic, what's-included version, Arabic version.",
      },
    ),
  ],
  specs: [
    "VIDEO — deliver each as 9:16 (1080×1920, master) + 1:1 (1080×1080) + 4:5 (1080×1350)",
    "STATIC — deliver as 1:1, 4:5 and 1200×628",
    "GBP — 1200×900 (4:3) plus a 1:1 crop",
  ],
  rules: [
    "Burned-in captions on EVERY video — most views are muted",
    "Music must be licensed for PAID use — platform/in-app library tracks cannot be used in ads",
    "Every clinic-tagged deliverable names the clinic it is for — this is the qualification lever",
    "Keep logo, price and CTA inside the safe areas on every crop",
    "Deliver source masters (project files + fonts + music licences) in _source/",
    "Brand kit, logos, characters and clinic photography are on the main Jobs Pack page — reuse them rather than sourcing stock",
    "Generate freely with your own AI stack (Seedance, Higgsfield, etc.) — especially for Lane A. Brand-safe means no medical claims, no before/after promises, no unnaturally white teeth, and the real logo only (never an AI-drawn one)",
  ],
  schedule: [
    { day: "Day 1 — 28 Jul", focus: "Brand + landing pages. Build Lane E and D masters (4 video, 4 static) and lock the template system.", target: "Lock the system" },
    { day: "Day 2 — 29 Jul", focus: "Lane J and C masters, then derive Lane E + D variants and GBP.", target: "Masters done" },
    { day: "Day 3 — 30 Jul", focus: "Lane B masters, Lane A brand-awareness videos, remaining derivatives, all GBP, exports and handover.", target: "Lane A + remaining" },
  ],
  done: [
    "All three crops exported and readable in each",
    "Captions burned in and correct",
    "Music cleared for paid use",
    "Price, offer, clinic and CTA legible on mobile",
    "Files follow the naming convention and sit in the right lane folder",
    "Source masters included in _source/",
  ],
  reference: [
    "Live offers — https://www.dentalnation.com/en (Signature offers section)",
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
    masters: all.filter((c) => c.tier === "master").reduce((n, c) => n + c.count, 0),
    variants: all.filter((c) => c.tier === "variant").reduce((n, c) => n + c.count, 0),
  };
}

