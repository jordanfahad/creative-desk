import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  db,
  getJob,
  getAssetsByIds,
  getBrandKit,
  assetWebPath,
  jobPlatformKeys,
  type Brief as BriefRow,
  type Asset,
} from "@/lib/db";
import { BriefSchema, type Brief } from "@/lib/context";
import { generateImage, editImage, uploadImageToFal, enqueueVideo } from "@/lib/fal";
import { finishImage } from "@/lib/finish";
import { finishVideo } from "@/lib/finishVideo";
import { platformOf, MASTER_IMAGE_SIZE, MASTER_ASPECT, type Platform, type LogoPosition } from "@/lib/platform";

export const runtime = "nodejs";

// Generate ONCE (the AI master), then fan out FREE deterministic crops + logo to
// every selected channel. Driven by intent (optimize|create) x media (image|video).
//   image/create   -> FLUX per shot -> master -> crop per channel
//   image/optimize  -> Kontext per source photo -> master -> crop per channel
//   video/optimize passthrough -> ffmpeg-finish the uploaded clip per channel
//   video (else)    -> Kling master clip (queued) -> poll fans out per channel

const STORAGE_ROOT = resolve(process.env.CREATIVE_DESK_STORAGE || "./storage");

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

function mimeFromPath(p: string): string {
  const ext = p.slice(p.lastIndexOf(".")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: "FAL_KEY is not set in .env.local" }, { status: 500 });
  }

  let body: { jobId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const jobId = Number(body.jobId);
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: `Job ${jobId} not found` }, { status: 404 });

  // brief is optional (only create/animate need it); parse defensively
  const briefRow = db
    .prepare("SELECT * FROM briefs WHERE job_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(jobId) as BriefRow | undefined;
  let brief: Brief | null = null;
  if (briefRow) {
    const parsed = BriefSchema.safeParse(JSON.parse(briefRow.content || "null"));
    brief = parsed.success ? parsed.data : null;
  }

  const platforms: Platform[] = jobPlatformKeys(job).map(platformOf);
  if (!platforms.length) {
    return NextResponse.json({ error: "Pick at least one channel to export to." }, { status: 400 });
  }

  const brand = getBrandKit();
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
    /* corrupt asset_ids -> treat as none */
  }
  const assets = getAssetsByIds(assetIds);
  const imageAssets = assets.filter((a) => a.media !== "video");
  const videoAssets = assets.filter((a) => a.media === "video");

  const rendersDir = join(STORAGE_ROOT, "renders");
  await mkdir(rendersDir, { recursive: true });
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
    db
      .prepare(
        `INSERT INTO renders (job_id, brief_id, shot_index, source_asset_id, platform, request_id, status_url, status, result_url, error, attempts, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        jobId,
        briefRow?.id ?? null,
        r.group,
        r.sourceAssetId,
        r.platform,
        r.request_id ?? null,
        r.status_url ?? null,
        r.status,
        r.result_url ?? null,
        r.error ?? null,
        JSON.stringify(r.meta ?? {}),
      );

  // master image buffer -> one finished deliverable per selected channel
  const fanOutImage = async (master: Buffer, group: number, sourceAssetId: number | null, meta: object) => {
    for (const platform of platforms) {
      try {
        const finished = await finishImage(master, { platform, ...logoOpts });
        const name = `${jobId}-${group}-${platform.key}-${randomUUID().slice(0, 6)}.jpg`;
        await writeFile(join(rendersDir, name), finished);
        insertRender({
          group,
          sourceAssetId,
          platform: platform.key,
          status: "completed",
          result_url: assetWebPath(`storage/renders/${name}`),
          meta,
        });
        results.push({ group, platform: platform.key, status: "completed" });
      } catch (e) {
        insertRender({ group, sourceAssetId, platform: platform.key, status: "failed", error: errMsg(e), meta });
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
        const instruction =
          brief?.shots?.[0]?.prompt ||
          job.brief_notes ||
          "Clean up and enhance: fix lighting, balance the composition, remove clutter.";
        if (job.combine === 1 && imageAssets.length > 1) {
          const urls = await uploadAssets(imageAssets);
          const master = await fetchBuf(
            (await editImage(`Edit and combine these photos on-brand. ${instruction} ${brandHint}`, urls, MASTER_ASPECT)).url,
          );
          await fanOutImage(master, 0, null, { mode: "optimize", combined: imageAssets.length });
        } else {
          for (let i = 0; i < imageAssets.length; i++) {
            try {
              const url = await uploadAsset(imageAssets[i]);
              const master = await fetchBuf(
                (await editImage(`Edit and enhance this photo on-brand, keep the real subject. ${instruction} ${brandHint}`, [url], MASTER_ASPECT)).url,
              );
              await fanOutImage(master, i, imageAssets[i].id, { mode: "optimize", asset_id: imageAssets[i].id });
            } catch (e) {
              results.push({ group: i, platform: null, status: "failed", error: errMsg(e) });
            }
          }
        }
      } else {
        // create from a prompt -> needs a brief
        if (!brief) {
          return NextResponse.json(
            { error: "Generate a brief first — Create mode builds from a prompt." },
            { status: 400 },
          );
        }
        for (const shot of brief.shots) {
          try {
            const master = await fetchBuf(
              (await generateImage(`${shot.prompt} ${brandHint}`, MASTER_IMAGE_SIZE)).url,
            );
            await fanOutImage(master, shot.index, null, { mode: "create", caption: shot.caption });
          } catch (e) {
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
              const out = `${jobId}-${i}-${platform.key}-${randomUUID().slice(0, 6)}.mp4`;
              await finishVideo(resolve(videoAssets[i].local_path), join(rendersDir, out), {
                platform,
                ...logoOpts,
              });
              insertRender({
                group: i,
                sourceAssetId: videoAssets[i].id,
                platform: platform.key,
                status: "completed",
                result_url: assetWebPath(`storage/renders/${out}`),
                meta: { mode: "passthrough" },
              });
              results.push({ group: i, platform: platform.key, status: "completed" });
            } catch (e) {
              insertRender({ group: i, sourceAssetId: videoAssets[i].id, platform: platform.key, status: "failed", error: errMsg(e), meta: {} });
              results.push({ group: i, platform: platform.key, status: "failed", error: errMsg(e) });
            }
          }
        }
      } else {
        // video create/animate (or ai_enhance) -> one Kling master clip, queued.
        const instruction = brief?.shots?.[0]?.prompt || job.brief_notes || "An on-brand promotional clip.";
        let seedUrl: string;
        let seedAssetId: number | null = null;
        if (imageAssets.length) {
          seedUrl = await uploadAsset(imageAssets[0]);
          seedAssetId = imageAssets[0].id;
        } else {
          seedUrl = (await generateImage(`${instruction} ${brandHint}`, MASTER_IMAGE_SIZE)).url;
        }
        const maxDur = Math.max(5, ...platforms.map((p) => p.maxDurationSeconds ?? 5));
        const sub = await enqueueVideo(`${instruction} ${brandHint}`, seedUrl, maxDur);
        insertRender({
          group: 0,
          sourceAssetId: seedAssetId,
          platform: null, // master; poll fans out to channels
          status: "processing",
          request_id: sub.requestId,
          status_url: sub.model,
          meta: { master: true, seedUrl },
        });
        results.push({ group: 0, platform: null, status: "processing" });
      }
    }
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }

  // ── job status rollup ──
  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('queued','processing') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
         COUNT(*) AS total
       FROM renders WHERE job_id = ?`,
    )
    .get(jobId) as { pending: number; done: number; failed: number; total: number };

  let status = job.status;
  if (counts.total === 0) {
    /* nothing inserted; an error was already returned above in most paths */
  } else if (counts.pending > 0) {
    status = "submitted";
  } else if (counts.done > 0) {
    status = "done"; // may be partial; failed rows are shown in the gallery
  } else {
    status = "failed";
  }
  if (status !== job.status) {
    db.prepare("UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, jobId);
  }

  return NextResponse.json({ jobId, intent: job.intent, media: job.media, status, submitted: results });
}

// ── helpers ──
async function uploadAsset(a: Asset): Promise<string> {
  const buf = await readFile(resolve(a.local_path));
  return uploadImageToFal(buf, mimeFromPath(a.local_path));
}
async function uploadAssets(list: Asset[]): Promise<string[]> {
  const out: string[] = [];
  for (const a of list) out.push(await uploadAsset(a));
  return out;
}
async function fetchBuf(url: string): Promise<Buffer> {
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}
