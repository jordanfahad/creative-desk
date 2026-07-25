import { readFileSync } from "node:fs";
const env = {};
for (const l of readFileSync("C:/Users/jorda/creative-desk/.env.local", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2];
}
const enc = new TextEncoder();
const b64 = (b) => { let s = ""; for (const x of b) s += String.fromCharCode(x); return Buffer.from(s, "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
async function cookie() {
  const key = await crypto.subtle.importKey("raw", enc.encode(env.SUPABASE_SECRET_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const p = b64(enc.encode(`jordan.fahad@gmail.com|${Date.now() + 3600000}`));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(p)));
  return `cd_session=${p}.${b64(sig)}`;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  console.log("waiting 150s for deploy…");
  await wait(150000);
  const ck = await cookie();
  const r = await fetch("https://creative-desk.vercel.app/api/generate-brief", { method: "POST", headers: { cookie: ck, "content-type": "application/json" }, body: JSON.stringify({ jobId: 3 }) });
  console.log("brief:", r.status);
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const { data } = await sb.from("briefs").select("content").eq("job_id", 3).order("id", { ascending: false }).limit(1).single();
  const p = JSON.parse(data.content);
  console.log("\nCONCEPT:", p.concept, "\n");
  p.shots.forEach((s, i) => {
    console.log(`SHOT ${i} cap="${s.caption}"`);
    console.log("  PROMPT:", s.prompt);
    console.log("  NEG:", s.negative, "\n");
  });
  // logo/text leak check
  const leak = p.shots.some((s) => /logo|brand|badge|embroider|sign(age)?|watermark/i.test(s.prompt));
  console.log(leak ? "⚠ LOGO/TEXT STILL IN A PROMPT" : "✓ no logo/text in any shot prompt");
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
