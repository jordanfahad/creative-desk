// One-off: create a tiny test video, upload it to Supabase Storage, and insert
// an asset + a video/optimize/passthrough job so we can fire the LIVE Vercel
// render and confirm ffmpeg works in the serverless runtime.
//   node scripts/_video-test-setup.mjs [--logo]
import { createClient } from "@supabase/supabase-js";
import ffmpegStatic from "ffmpeg-static";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// load .env.local
const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;
const BUCKET = env.SUPABASE_BUCKET || "creative-desk";
if (!URL || !KEY) throw new Error("missing SUPABASE_URL / SUPABASE_SECRET_KEY in .env.local");
const withLogo = process.argv.includes("--logo");

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// 1) generate a 3s 1280x720 moving test clip with a tone (no font dependency).
const out = join(tmpdir(), `cd-video-test-${Date.now()}.mp4`);
const args = [
  "-y",
  "-f", "lavfi", "-i", "testsrc2=s=1280x720:rate=30:d=3",
  "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
  out,
];
const r = spawnSync(ffmpegStatic, args, { encoding: "utf8" });
if (r.status !== 0) throw new Error("local ffmpeg failed: " + (r.stderr || "").slice(-500));
const buf = readFileSync(out);
console.log(`generated test clip: ${(buf.length / 1024).toFixed(0)} KB`);

// 2) upload to Storage
const key = `assets/video-test-${Date.now()}.mp4`;
const up = await sb.storage.from(BUCKET).upload(key, buf, { contentType: "video/mp4", upsert: true });
if (up.error) throw up.error;
const publicUrl = `${URL}/storage/v1/object/public/${BUCKET}/${key}`;
console.log("uploaded:", publicUrl);

// 3) insert asset (media=video)
const a = await sb
  .from("assets")
  .insert({ filename: "video-test.mp4", local_path: publicUrl, public_url: publicUrl, kind: "clinic", media: "video", quality: "good", notes: "ffmpeg serverless test" })
  .select("id")
  .single();
if (a.error) throw a.error;
const assetId = a.data.id;

// 4) insert job (optimize / video / passthrough), 2 channels (a crop + a different crop)
const j = await sb
  .from("jobs")
  .insert({
    title: withLogo ? "LIVE video test (logo)" : "LIVE video ffmpeg test",
    intent: "optimize",
    media: "video",
    video_mode: "passthrough",
    platforms: JSON.stringify(["org_ig_story_reel_916", "gmb_square"]),
    asset_ids: JSON.stringify([assetId]),
    logo_enabled: withLogo ? 1 : 0,
    logo_position: "bottom-right",
    status: "ready",
  })
  .select("id")
  .single();
if (j.error) throw j.error;

console.log("ASSET_ID=" + assetId);
console.log("JOB_ID=" + j.data.id);
