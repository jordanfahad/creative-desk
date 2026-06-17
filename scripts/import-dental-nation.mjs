// One-off: embed the Dental Nation brand context into the desk.
//   - sets the brand kit (palette, fonts, voice, guardrails) from the brandbook
//   - loads the two Founder briefs as CEO guidelines (highest priority)
//   - loads the Creative Team trade pack as a Creative guideline
//   - adds a concise Brand Book essentials guideline + attaches the full PDF
// Re-runnable: it clears guidelines and re-imports. Source PDFs are copied into
// ./storage/guidelines so they're viewable in the app.
//
//   node scripts/import-dental-nation.mjs

import Database from "better-sqlite3";
import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

const SRC = {
  founder: "C:/Users/jorda/Downloads/PDF-2026/Final_Founder_Brief__Dental_Nation (3).pdf",
  operating: "C:/Users/jorda/Downloads/PDF-2026/Dental_Nation_Founder_Operating_Brief_ (3).pdf",
  creative: "C:/Users/jorda/Downloads/PDF-2026/Dental_Nation_Creative_Team_PDF_Trade_Pack_v1 (5).pdf",
  brandbook: "C:/Users/jorda/Downloads/Dental Nation Brandbook Final.pdf",
};

const STORAGE = resolve(process.env.CREATIVE_DESK_STORAGE || "./storage");
const GDIR = join(STORAGE, "guidelines");
mkdirSync(GDIR, { recursive: true });

// Extract in a child process (no better-sqlite3 loaded there) — the native
// sqlite addon in this process interferes with pdfjs and truncates output.
function extract(p) {
  return execFileSync("node", [join(process.cwd(), "scripts", "_pdftext.mjs"), p], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  }).trim();
}

function stash(srcPath, name) {
  copyFileSync(srcPath, join(GDIR, name));
  return `storage/guidelines/${name}`;
}

console.log("Extracting briefs…");
const founderText = await extract(SRC.founder);
const operatingText = await extract(SRC.operating);
const creativeText = await extract(SRC.creative);

console.log("Copying PDFs into ./storage/guidelines…");
const founderDoc = stash(SRC.founder, "founder-brief.pdf");
const operatingDoc = stash(SRC.operating, "founder-operating-brief.pdf");
const creativeDoc = stash(SRC.creative, "creative-trade-pack.pdf");
const brandbookDoc = stash(SRC.brandbook, "brandbook.pdf");

const brandbookEssentials = [
  "Brand Book essentials — Dental Nation (tagline: Beyond Smiles). Designed by Farbod Mehr Studio.",
  "",
  "Palette: Deep Navy #244260 (primary, authority), Off-White #F7F5EF (backgrounds), Mint Green #CFE2D0 (fresh accent).",
  "Supporting accents: #5793A3, #B1CCDC, #A9C3A6, #DFA798, #FFED9F. Calm off-white backgrounds; navy for trust; mint for freshness.",
  "Typography: Helvetica is the primary typeface (~80% of communications); Optima is the elegant secondary accent. Clean, professional, modern.",
  "Tone of voice: empathetic, reassuring, modern, informative, friendly, empowering. Premium-but-accessible and trust-led — calm confidence.",
  "Photography & layout: clean, spacious, restrained whitespace; never gruesome, clinical-gore, or cluttered.",
  "Posture: NON-DISCOUNT. Premium positioning, not a discounter; lead with trust and experience, not price cuts.",
].join("\n");

const db = new Database(resolve(process.env.CREATIVE_DESK_DB || "./data/creative-desk.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8"));
// safety: ensure source/doc_path columns exist on older DBs
const gCols = new Set(db.prepare("PRAGMA table_info(guidelines)").all().map((c) => c.name));
if (!gCols.has("source")) db.exec("ALTER TABLE guidelines ADD COLUMN source TEXT NOT NULL DEFAULT 'general'");
if (!gCols.has("doc_path")) db.exec("ALTER TABLE guidelines ADD COLUMN doc_path TEXT");

console.log("Setting the Dental Nation brand kit…");
db.prepare(
  `INSERT INTO brand_kit (id, clinic_name, tagline, voice, colors, fonts, do_not_say, boilerplate, updated_at)
   VALUES (1, @clinic_name, @tagline, @voice, @colors, @fonts, @do_not_say, @boilerplate, datetime('now'))
   ON CONFLICT(id) DO UPDATE SET
     clinic_name=excluded.clinic_name, tagline=excluded.tagline, voice=excluded.voice,
     colors=excluded.colors, fonts=excluded.fonts, do_not_say=excluded.do_not_say,
     boilerplate=excluded.boilerplate, updated_at=datetime('now')`,
).run({
  clinic_name: "Dental Nation",
  tagline: "Beyond Smiles",
  voice:
    "Empathetic, reassuring, modern, informative, friendly, empowering. Premium-but-accessible and trust-led — calm confidence, never hype or discounting. Dubai-born, GCC-built.",
  colors: JSON.stringify(["#244260", "#F7F5EF", "#CFE2D0", "#5793A3", "#A9C3A6", "#DFA798"]),
  fonts: JSON.stringify(["Helvetica", "Optima"]),
  do_not_say: JSON.stringify([
    "position as a discounter or lead with discounts (non-discount posture)",
    "gruesome, clinical-gore, or cluttered visuals",
    "guaranteed results or painless / pain-free claims",
    "specific medical outcomes or cures",
    "aggressive direct-response or telehealth tone",
    "copying a benchmark brand's copy, icons, or claims (translate patterns, not content)",
  ]),
  boilerplate:
    "Dental Nation — the GCC's leading branded dental health platform. Dubai-born, GCC-built.",
});

console.log("Replacing guidelines…");
db.prepare("DELETE FROM guidelines").run();
const ins = db.prepare(
  "INSERT INTO guidelines (title, body, source, doc_path, active) VALUES (?, ?, ?, ?, 1)",
);
ins.run("Founder Brief — What Dental Nation Is Building", founderText, "ceo", founderDoc);
ins.run("Founder Operating Brief — Dubai Launchpad, GCC Scale", operatingText, "ceo", operatingDoc);
ins.run("Creative Team Trade Pack — Benchmark Translation", creativeText, "creative", creativeDoc);
ins.run("Brand Book essentials — Beyond Smiles", brandbookEssentials, "general", brandbookDoc);

console.log("\nDone. Brand:", db.prepare("SELECT clinic_name, tagline FROM brand_kit WHERE id=1").get());
console.log(
  "Guidelines:",
  db.prepare("SELECT source, title, length(body) AS chars FROM guidelines ORDER BY source").all(),
);
db.close();
