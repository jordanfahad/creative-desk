// One-off: create the private bucket and move confidential PDFs (guideline +
// brief docs) out of the public bucket into it, rewriting doc_path/brief_doc_path
// to private storage KEYS and deleting the now-private public copies.
//   node scripts/_migrate-private-docs.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;
const PUBLIC_BUCKET = env.SUPABASE_BUCKET || "creative-desk";
const PRIVATE_BUCKET = env.SUPABASE_PRIVATE_BUCKET || "creative-desk-private";
if (!URL || !KEY) throw new Error("missing SUPABASE_URL / SUPABASE_SECRET_KEY");

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// 1) private bucket is created out-of-band via SQL (the API caps fileSizeLimit
//    at the project global). Just verify it exists.
const { data: buckets } = await sb.storage.listBuckets();
if (!(buckets || []).some((b) => b.name === PRIVATE_BUCKET)) {
  throw new Error(`private bucket ${PRIVATE_BUCKET} not found — create it first`);
}
console.log(`private bucket ready: ${PRIVATE_BUCKET}`);

// derive the storage key from a stored value (full public URL or already a key)
function keyOf(stored) {
  if (!stored) return null;
  if (!/^https?:\/\//.test(stored)) return stored; // already a key
  const marker = `/public/${PUBLIC_BUCKET}/`;
  const i = stored.indexOf(marker);
  return i === -1 ? null : stored.slice(i + marker.length);
}

async function migrate(stored) {
  const key = keyOf(stored);
  if (!key) return { skipped: stored };
  if (!/^https?:\/\//.test(stored)) return { alreadyPrivateKey: key };
  // fetch the (still public) bytes, upload to private bucket under same key
  const res = await fetch(stored);
  if (!res.ok) throw new Error(`fetch ${res.status} for ${stored}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const up = await sb.storage.from(PRIVATE_BUCKET).upload(key, buf, { contentType: "application/pdf", upsert: true });
  if (up.error) throw up.error;
  // remove the public copy
  await sb.storage.from(PUBLIC_BUCKET).remove([key]);
  return { key, bytes: buf.length };
}

// 2) guidelines
const { data: gs } = await sb.from("guidelines").select("id, doc_path").not("doc_path", "is", null);
for (const g of gs || []) {
  const r = await migrate(g.doc_path);
  if (r.key) {
    await sb.from("guidelines").update({ doc_path: r.key }).eq("id", g.id);
    console.log(`guideline #${g.id} -> private ${r.key} (${(r.bytes / 1024).toFixed(0)} KB)`);
  } else {
    console.log(`guideline #${g.id}:`, JSON.stringify(r));
  }
}

// 3) job brief docs
const { data: js } = await sb.from("jobs").select("id, brief_doc_path").not("brief_doc_path", "is", null);
for (const j of js || []) {
  const r = await migrate(j.brief_doc_path);
  if (r.key) {
    await sb.from("jobs").update({ brief_doc_path: r.key }).eq("id", j.id);
    console.log(`job #${j.id} brief -> private ${r.key}`);
  } else {
    console.log(`job #${j.id}:`, JSON.stringify(r));
  }
}

console.log("DONE");
