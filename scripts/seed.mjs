// Seed the local SQLite store with a brand kit, one guideline, a sample asset,
// and two jobs (one static, one dynamic) so you can exercise the spine end to
// end. Safe to re-run — it clears and re-inserts the sample rows.
//
//   npm run db:seed
//
// This is a convenience seeder, not the asset-upload / job-builder UI (next).

import Database from "better-sqlite3";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

const DB_PATH = resolve(process.env.CREATIVE_DESK_DB || "./data/creative-desk.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8"));

// Brand kit (single row).
db.prepare(
  `INSERT INTO brand_kit (id, clinic_name, tagline, voice, colors, fonts, do_not_say, boilerplate)
   VALUES (1, @clinic_name, @tagline, @voice, @colors, @fonts, @do_not_say, @boilerplate)
   ON CONFLICT(id) DO UPDATE SET
     clinic_name=excluded.clinic_name, tagline=excluded.tagline, voice=excluded.voice,
     colors=excluded.colors, fonts=excluded.fonts, do_not_say=excluded.do_not_say,
     boilerplate=excluded.boilerplate, updated_at=datetime('now')`,
).run({
  clinic_name: "Bright Smile Dental",
  tagline: "Gentle, modern dentistry",
  voice: "Warm, reassuring, plain-English. No hype, no jargon.",
  colors: JSON.stringify(["#0e7c86", "#f4f1ea", "#1a1a1a"]),
  fonts: JSON.stringify(["Fraunces", "Inter"]),
  do_not_say: JSON.stringify([
    "guaranteed results",
    "painless / pain-free",
    "best dentist in town",
    "any specific health outcome or cure",
  ]),
  boilerplate: "Bright Smile Dental — book online or call. New patients welcome.",
});

// One active guideline.
db.prepare("DELETE FROM guidelines").run();
db.prepare(
  "INSERT INTO guidelines (title, body, active) VALUES (?, ?, 1)",
).run(
  "Trust over flash",
  "Lead with real people and calm interiors. Show the team and the space, not stock-looking perfection. Captions stay short and human.",
);

// A sample asset — write a small placeholder image so the thumbnail renders.
mkdirSync(resolve(process.env.CREATIVE_DESK_STORAGE || "./storage", "assets"), {
  recursive: true,
});
writeFileSync(
  resolve(process.env.CREATIVE_DESK_STORAGE || "./storage", "assets", "reception-01.jpg"),
  Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==",
    "base64",
  ),
);

db.prepare("DELETE FROM assets").run();
const asset = db
  .prepare(
    "INSERT INTO assets (filename, local_path, kind, quality, notes) VALUES (?, ?, ?, ?, ?)",
  )
  .run(
    "reception-01.jpg",
    "storage/assets/reception-01.jpg",
    "clinic",
    "good",
    "Front desk, morning light.",
  );

// Two jobs.
db.prepare("DELETE FROM jobs").run();
db.prepare(
  `INSERT INTO jobs (title, mode, goal, brief_notes, asset_ids, status)
   VALUES (?, 'static', ?, ?, ?, 'draft')`,
).run(
  "GMB trust set — reception",
  "Build Google Business Profile trust",
  "Three calm, on-brand stills of the clinic space.",
  JSON.stringify([asset.lastInsertRowid]),
);

db.prepare(
  `INSERT INTO jobs (title, mode, goal, brief_notes, asset_ids, status)
   VALUES (?, 'dynamic', ?, ?, ?, 'draft')`,
).run(
  "Awareness clip — new patients",
  "Awareness — attract new patients",
  "Short, friendly 9:16 clip. Animate the reception still subtly.",
  JSON.stringify([asset.lastInsertRowid]),
);

console.log("Seeded:", DB_PATH);
console.log("Jobs:", db.prepare("SELECT id, title, mode, status FROM jobs").all());
db.close();
