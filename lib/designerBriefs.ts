// Per-designer sprint briefs shown at /download-jobs/<slug>.
// Kept in the repo (not the DB) deliberately: a brief is a versioned artefact —
// it should be reviewable in a diff and travel with the deploy that created it.

export interface BriefConcept {
  ref: string;
  kind: "video" | "static" | "gbp";
  title: string;
  note: string;
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
  hours: number;
  channels: string;
  bias: string;
  uploadPrefix: string;
  intro: string[];
  rates: Array<{ type: string; each: string }>;
  lanes: BriefLane[];
  specs: string[];
  rules: string[];
  schedule: Array<{ day: string; focus: string; target: string }>;
  done: string[];
  reference: string[];
}

const HASHID: DesignerBrief = {
  slug: "hashid",
  name: "Hashid",
  dates: "28–30 July 2026 (3 days)",
  hours: 45,
  channels: "Social organic · Social paid · Google Business Profile",
  bias: "Video-heavy",
  uploadPrefix: "deliveries/Hashid_2026-07-28",
  intro: [
    "An asset means ONE UNIQUE CONCEPT — not a size variant. Re-cropping a finished video to 1:1 / 4:5 / 16:9 is an export, and is expected as part of delivering the concept rather than counted separately.",
    "Every concept must state the offer, the price and one clear action. Recent paid leads converted badly — a high share were wrong or unreachable contacts — so creative should QUALIFY rather than maximise clicks. Be explicit about what the offer is, what it costs, and which clinic it is at. Fewer, better-qualified enquiries beat volume here.",
    "Lanes are ordered by live paid spend: E, D and J carry the ArabyAds campaign and come first. C and B are organic/supporting. If the days slip, cut from the bottom of that order rather than lowering quality across the board.",
  ],
  rates: [
    { type: "Short-form video (15–30s vertical)", each: "~2.5 h" },
    { type: "Static / carousel key visual", each: "~1 h" },
    { type: "Google Business Profile post", each: "~0.5 h" },
  ],
  lanes: [
    {
      key: "E",
      name: "Glow Up (whitening)",
      offer: "The DN Glow Up — from AED 1,699",
      landing: "https://www.dentalnation.com/en/glow-up",
      priority: "Paid — highest value",
      direction: "Highest-value offer. Lead with the visible outcome.",
      concepts: [
        { ref: "E-V1", kind: "video", title: "Before/after transformation", note: "Close-up, natural light. The result is the hook." },
        { ref: "E-V2", kind: "video", title: "What actually happens in a Glow Up", note: "The session, step by step — demystifies and reassures." },
        { ref: "E-V3", kind: "video", title: "Couples angle", note: "DN Glow Up Couples, AED 2,999 — occasion-led (wedding, anniversary)." },
        { ref: "E-S1", kind: "static", title: "Before/after key visual", note: "Price-forward." },
        { ref: "E-G1", kind: "gbp", title: "GBP post — offer + clinic + book", note: "" },
      ],
    },
    {
      key: "D",
      name: "SOS (emergency)",
      offer: "DN SOS — Seen in 60 — from AED 699",
      landing: "https://www.dentalnation.com/en/sos",
      priority: "Paid",
      direction: "Urgency and reassurance. Same-day care is the hook.",
      concepts: [
        { ref: "D-V1", kind: "video", title: "“Seen in 60” — the promise", note: "Timer-led, unambiguous." },
        { ref: "D-V2", kind: "video", title: "Pain-relief reassurance", note: "Calm tone — what to do right now." },
        { ref: "D-V3", kind: "video", title: "After-hours / weekend availability", note: "" },
        { ref: "D-S1", kind: "static", title: "Emergency card", note: "Phone number and WhatsApp prominent." },
        { ref: "D-G1", kind: "gbp", title: "GBP post — same-day emergency slots", note: "" },
      ],
    },
    {
      key: "J",
      name: "Scan (orthodontics)",
      offer: "The DN Scan — from AED 499",
      landing: "https://www.dentalnation.com/en/scan",
      priority: "Paid",
      direction: "Low-commitment entry point. Curiosity-led.",
      concepts: [
        { ref: "J-V1", kind: "video", title: "What the scan shows you", note: "Screen-capture feel." },
        { ref: "J-V2", kind: "video", title: "“Am I a candidate for aligners?”", note: "Quick-answer format." },
        { ref: "J-V3", kind: "video", title: "Price-anchored", note: "AED 499 vs the cost of doing nothing." },
        { ref: "J-S1", kind: "static", title: "Scan visual", note: "Price-forward." },
        { ref: "J-G1", kind: "gbp", title: "GBP post — book a scan", note: "" },
      ],
    },
    {
      key: "C",
      name: "Restore (implants / restorative)",
      offer: "The DN Plan — complimentary (valued AED 899)",
      landing: "https://www.dentalnation.com/en/care-journeys/restore",
      priority: "Organic / supporting",
      direction: "Higher consideration. Trust and expertise over urgency.",
      concepts: [
        { ref: "C-V1", kind: "video", title: "The DN Plan explained", note: "What a complimentary consult includes." },
        { ref: "C-V2", kind: "video", title: "Restorative journey", note: "Patient-story framing." },
        { ref: "C-S1", kind: "static", title: "Plan value visual", note: "Complimentary, valued AED 899." },
        { ref: "C-G1", kind: "gbp", title: "GBP post — book a consultation", note: "" },
      ],
    },
    {
      key: "B",
      name: "First Look (new patient)",
      offer: "The DN First Look — from AED 799",
      landing: "https://www.dentalnation.com/en/first-look",
      priority: "Organic / supporting",
      direction: "Welcome offer. Warm, low-anxiety.",
      concepts: [
        { ref: "B-V1", kind: "video", title: "First visit walkthrough", note: "What to expect — anxiety-reducing." },
        { ref: "B-V2", kind: "video", title: "What's included at AED 799", note: "" },
        { ref: "B-S1", kind: "static", title: "Welcome key visual", note: "" },
        { ref: "B-G1", kind: "gbp", title: "GBP post — new-patient offer", note: "" },
      ],
    },
  ],
  specs: [
    "VIDEO — deliver each concept as 9:16 (1080×1920, master) + 1:1 (1080×1080) + 4:5 (1080×1350)",
    "STATIC — deliver as 1:1, 4:5 and 1200×628",
    "GBP — 1200×900 (4:3) plus a 1:1 crop",
  ],
  rules: [
    "Burned-in captions on EVERY video — most views are muted",
    "Music must be licensed for PAID use — do not use in-app/platform library tracks, they cannot be used in ads",
    "Keep logo, price and CTA inside the safe areas on every crop",
    "Deliver source master files (project + fonts) alongside the finals, in _source/",
  ],
  schedule: [
    { day: "Day 1 — 28 Jul", focus: "Brand familiarisation, review the 5 landing pages, Lane E + Lane D video", target: "6 concepts" },
    { day: "Day 2 — 29 Jul", focus: "Lane J complete, Lane C video + static", target: "9 concepts" },
    { day: "Day 3 — 30 Jul", focus: "Lane B, all GBP posts, exports, handover", target: "8 concepts" },
  ],
  done: [
    "All three crops exported and readable in each",
    "Captions burned in and correct",
    "Music cleared for paid use",
    "Price, offer and CTA legible on mobile",
    "Files follow the naming convention and sit in the right folder",
    "Source files included",
  ],
  reference: [
    "Live offers — https://www.dentalnation.com/en (Signature offers section)",
    "Clinics — Dental Nation General Dental Clinic · Dr Tosun Dental Clinic",
    "Phone — +971 55 277 2311 (WhatsApp available)",
    "Brand kit, founder briefs and guidelines — on the main Jobs Pack page",
  ],
};

export const DESIGNER_BRIEFS: DesignerBrief[] = [HASHID];

export function designerBrief(slug: string): DesignerBrief | undefined {
  const s = slug.trim().toLowerCase();
  return DESIGNER_BRIEFS.find((b) => b.slug === s);
}

export function briefTotals(b: DesignerBrief) {
  const all = b.lanes.flatMap((l) => l.concepts);
  return {
    total: all.length,
    video: all.filter((c) => c.kind === "video").length,
    static: all.filter((c) => c.kind === "static").length,
    gbp: all.filter((c) => c.kind === "gbp").length,
  };
}

/** Planned hours from the per-type rates — keeps the brief honest about capacity. */
export function briefHours(b: DesignerBrief): number {
  const t = briefTotals(b);
  return t.video * 2.5 + t.static * 1 + t.gbp * 0.5;
}
