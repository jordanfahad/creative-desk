// One-off: copy the Dental Nation brand context (brand kit + logo + guideline
// PDFs) from the local SQLite DB into Supabase (DB + Storage).
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/migrate-to-supabase.mjs
import Database from "better-sqlite3";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || "creative-desk";
if (!URL || !KEY) throw new Error("set SUPABASE_URL and SUPABASE_SECRET_KEY");

const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const db = new Database("./data/creative-desk.db");
const pub = (key) => `${URL}/storage/v1/object/public/${BUCKET}/${key}`;

async function up(localPath, key, ct) {
  const buf = readFileSync(resolve(localPath));
  const { error } = await sb.storage.from(BUCKET).upload(key, buf, { contentType: ct, upsert: true });
  if (error) throw error;
  return pub(key);
}

const bk = db.prepare("SELECT * FROM brand_kit WHERE id = 1").get();
if (bk) {
  let logoUrl = null;
  if (bk.logo_path) {
    try {
      logoUrl = await up(bk.logo_path, "brand/" + bk.logo_path.split("/").pop(), "image/png");
    } catch (e) {
      console.log("logo upload skipped:", e.message);
    }
  }
  await sb.from("brand_kit").upsert(
    {
      id: 1,
      clinic_name: bk.clinic_name,
      logo_path: logoUrl,
      tagline: bk.tagline,
      voice: bk.voice,
      colors: bk.colors,
      fonts: bk.fonts,
      do_not_say: bk.do_not_say,
      boilerplate: bk.boilerplate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  console.log("brand_kit ->", bk.clinic_name, "| logo:", !!logoUrl);
}

// replace guidelines wholesale
await sb.from("guidelines").delete().neq("id", 0);
const gs = db.prepare("SELECT * FROM guidelines").all();
for (const g of gs) {
  let docUrl = null;
  if (g.doc_path) {
    try {
      docUrl = await up(g.doc_path, "guidelines/" + g.doc_path.split("/").pop(), "application/pdf");
    } catch (e) {
      console.log("doc upload skipped:", e.message);
    }
  }
  await sb.from("guidelines").insert({ title: g.title, body: g.body, source: g.source || "general", doc_path: docUrl, active: g.active ?? 1 });
  console.log("guideline ->", g.source, g.title);
}

console.log("DONE");
db.close();
