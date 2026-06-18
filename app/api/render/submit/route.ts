import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  supabase,
  getJob,
  getAssetsByIds,
  getBrandKit,
  getLatestBrief,
  listRenders,
  jobPlatformKeys,
} from "@/lib/db";
import { uploadBuffer } from "@/lib/storage";
import { BriefSchema, type Brief } from "@/lib/context";
import { generateImage, editImage, enqueueVideo } from "@/lib/fal";
import { finishImage } from "@/lib/finish";
import { finishVideo } from "@/lib/finishVideo";
import { platformOf, MASTER_IMAGE_SIZE, MASTER_ASPECT, type Platform, type LogoPosition } from "@/lib/platform";

export const runtime = "nodejs";
export const maxDuration = 300; // image edits + crops can take a while (Vercel Pro)

// Generate ONCE (AI master), fan out FREE crops + logo to every selected channel.
// Files live in Supabase Storage; source assets are public URLs passed straight to fal.

interface SubmitResult {
  group: number;
  platform: string | null;
  status: string;
  error?: string;
}

function parseColors(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
async function fetchBuf(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: "FAL_KEY is not set" }, { status: 500 });
  }

  let body: { jobId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const jobId = Number(body.jobId);
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: `Job ${jobId} not found` }, { status: 404 });

  const briefRow = await getLatestBrief(jobId);
  let brief: Brief | null = null;
  if (briefRow) {
    const parsed = BriefSchema.safeParse(JSON.parse(briefRow.content || "null"));
    brief = parsed.success ? parsed.data : null;
  }

  const platforms: Platform[] = jobPlatformKeys(job).map(platformOf);
  if (!platforms.length) {
    return NextResponse.json({ error: "Pick at least one channel to export to." }, { status: 400 });
  }

  const brand = await getBrandKit();
  const logoOpts = {
    logoPath: brand?.logo_path ?? null,
    logoEnabled: job.logo_enabled === 1,
    logoPosition: (job.logo_position as LogoPosition) || "bottom-right",
  };
  const colors = parseColors(brand?.colors ?? null);
  const brandHint = `On-brand for ${brand?.clinic_name ?? "the clinic"}: palette ${colors.join(", ")}; premium, calm, trustworthy; non-discount.`;

  let assetIds: number[] = [];
  try {
    const v = JSON.parse(job.asset_ids || "[]");
    if (Array.isArray(v)) assetIds = v.map(Number).filter(Number.isFinite);
  } catch {
    /* ignore */
  }
  const assets = await getAssetsByIds(assetIds);
  const imageAssets = assets.filter((a) => a.media !== "video");
  const videoAssets = assets.filter((a) => a.media === "video");
  const results: SubmitResult[] = [];

  const insertRender = (r: {
    group: number;
    sourceAssetId: number | null;
    platform: string | null;
    status: string;
    result_url?: string | null;
    request_id?: string | null;
    status_url?: string | null;
    error?: string | null;
    meta?: unknown;
  }) =>
    supabase.from("renders").insert({
      job_id: jobId,
      brief_id: briefRow?.id ?? null,
      shot_index: r.group,
      source_asset_id: r.sourceAssetId,
      platform: r.platform,
      request_id: r.request_id ?? null,
      status_url: r.status_url ?? null,
      status: r.status,
      result_url: r.result_url ?? null,
      error: r.error ?? null,
      attempts: 0,
      meta: JSON.stringify(r.meta ?? {}),
    });

  const fanOutImage = async (master: Buffer, group: number, sourceAssetId: number | null, meta: object) => {
    for (const platform of platforms) {
      try {
        const finished = await finishImage(master, { platform, ...logoOpts });
        const url = await uploadBuffer(`renders/${jobId}-${group}-${platform.key}-${randomUUID().slice(0, 6)}.jpg`, finished, "image/jpeg");
        await insertRender({ group, sourceAssetId, platform: platform.key, status: "completed", result_url: url, meta });
        results.push({ group, platform: platform.key, status: "completed" });
      } catch (e) {
        await insertRender({ group, sourceAssetId, platform: platform.key, status: "failed", error: errMsg(e), meta });
        results.push({ group, platform: platform.key, status: "failed", error: errMsg(e) });
      }
    }
  };

  try {
    if (job.media !== "video") {
      // ───────────── IMAGES ─────────────
      if (job.intent === "optimize") {
        if (!imageAssets.length) {
          return NextResponse.json({ error: "Upload image creatives to optimize." }, { status: 400 });
        }
        // Prefer the AI-optimized edit prompt (already brand-rich) verbatim;
        // fall back to the raw direction + a brand reminder only if none exists.
        const optimized = brief?.shots?.[0]?.prompt;
        const instruction = optimized || job.brief_notes || "Clean up and enhance: fix lighting, balance the composition, remove clutter.";
        if (job.combine === 1 && imageAssets.length > 1) {
          const urls = imageAssets.map((a) => a.local_path);
          const editPrompt = optimized
            ? `Combine these photos into one balanced, on-brand composition. ${instruction}`
            : `Edit and combine these photos on-brand, keep the real subjects. ${instruction} ${brandHint}`;
          const master = await fetchBuf((await editImage(editPrompt, urls, MASTER_ASPECT)).url);
          await fanOutImage(master, 0, null, { mode: "optimize", combined: imageAssets.length });
        } else {
          const editPrompt = optimized
            ? instruction
            : `Edit and enhance this photo on-brand, keep the real subject. ${instruction} ${brandHint}`;
          for (let i = 0; i < imageAssets.length; i++) {
            try {
              const master = await fetchBuf((await editImage(editPrompt, [imageAssets[i].local_path], MASTER_ASPECT)).url);
              await fanOutImage(master, i, imageAssets[i].id, { mode: "optimize", asset_id: imageAssets[i].id });
            } catch (e) {
              // master generation failed → record a failed deliverable per channel so it's visible
              for (const platform of platforms) {
                await insertRender({ group: i, sourceAssetId: imageAssets[i].id, platform: platform.key, status: "failed", error: errMsg(e), meta: { mode: "optimize" } });
              }
              results.push({ group: i, platform: null, status: "failed", error: errMsg(e) });
            }
          }
        }
      } else {
        if (!brief) {
          return NextResponse.json({ error: "Generate a brief first — Create mode builds from a prompt." }, { status: 400 });
        }
        for (const shot of brief.shots) {
          try {
            // shot.prompt is already a complete, brand-infused production prompt — use it verbatim.
            const master = await fetchBuf((await generateImage(shot.prompt, MASTER_IMAGE_SIZE)).url);
            await fanOutImage(master, shot.index, null, { mode: "create", caption: shot.caption });
          } catch (e) {
            for (const platform of platforms) {
              await insertRender({ group: shot.index, sourceAssetId: null, platform: platform.key, status: "failed", error: errMsg(e), meta: { mode: "create" } });
            }
            results.push({ group: shot.index, platform: null, status: "failed", error: errMsg(e) });
          }
        }
      }
    } else {
      // ───────────── VIDEO ─────────────
      if (job.intent === "optimize" && job.video_mode === "passthrough") {
        if (!videoAssets.length) {
          return NextResponse.json({ error: "Upload a video to optimize." }, { status: 400 });
        }
        for (let i = 0; i < videoAssets.length; i++) {
          for (const platform of platforms) {
            try {
              const url = await finishVideoToStorage(videoAssets[i].local_path, jobId, i, platform, logoOpts);
              await insertRender({ group: i, sourceAssetId: videoAssets[i].id, platform: platform.key, status: "completed", result_url: url, meta: { mode: "passthrough" } });
              results.push({ group: i, platform: platform.key, status: "completed" });
            } catch (e) {
              await insertRender({ group: i, sourceAssetId: videoAssets[i].id, platform: platform.key, status: "failed", error: errMsg(e), meta: {} });
              results.push({ group: i, platform: platform.key, status: "failed", error: errMsg(e) });
            }
          }
        }
      } else {
        const shot0 = brief?.shots?.[0];
        const optimized = shot0?.prompt;
        const motion = shot0?.motion ? ` Camera/motion: ${shot0.motion}.` : "";
        // optimized prompt is brand-rich → use verbatim (+ motion); else wrap raw direction.
        const instruction = optimized
          ? `${optimized}${motion}`
          : `${job.brief_notes || "An on-brand promotional clip."} ${brandHint}`;
        // the seed image gets the same brand-rich prompt (sans motion, since it's a still)
        const seedPrompt = optimized || `${job.brief_notes || "An on-brand promotional clip."} ${brandHint}`;
        let seedUrl: string;
        let seedAssetId: number | null = null;
        if (imageAssets.length) {
          seedUrl = imageAssets[0].local_path;
          seedAssetId = imageAssets[0].id;
        } else {
          seedUrl = (await generateImage(seedPrompt, MASTER_IMAGE_SIZE)).url;
        }
        const maxDur = Math.max(5, ...platforms.map((p) => p.maxDurationSeconds ?? 5));
        const sub = await enqueueVideo(instruction, seedUrl, maxDur);
        await insertRender({ group: 0, sourceAssetId: seedAssetId, platform: null, status: "processing", request_id: sub.requestId, status_url: sub.model, meta: { master: true } });
        results.push({ group: 0, platform: null, status: "processing" });
      }
    }
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }

  // ── job status rollup (computed in JS) ──
  const rows = await listRenders(jobId);
  const pending = rows.filter((r) => r.status === "queued" || r.status === "processing").length;
  const done = rows.filter((r) => r.status === "completed").length;
  let status = job.status;
  if (rows.length) {
    status = pending > 0 ? "submitted" : done > 0 ? "done" : "failed";
  }
  if (status !== job.status) {
    await supabase.from("jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", jobId);
  }

  return NextResponse.json({ jobId, intent: job.intent, media: job.media, status, submitted: results });
}

// finishVideo writes to a file; do it in a temp dir, upload to storage, clean up.
async function finishVideoToStorage(
  inputUrl: string,
  jobId: number,
  group: number,
  platform: Platform,
  logoOpts: { logoPath: string | null; logoEnabled: boolean; logoPosition: LogoPosition },
): Promise<string> {
  const dir = join(tmpdir(), "creative-desk");
  await mkdir(dir, { recursive: true });
  const out = join(dir, `${jobId}-${group}-${platform.key}-${randomUUID().slice(0, 6)}.mp4`);
  await finishVideo(inputUrl, out, { platform, ...logoOpts });
  const buf = await readFile(out);
  const url = await uploadBuffer(`renders/${jobId}-${group}-${platform.key}-${randomUUID().slice(0, 6)}.mp4`, buf, "video/mp4");
  await unlink(out).catch(() => {});
  return url;
}
