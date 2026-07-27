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
  getLogo,
  getLatestBrief,
  listRenders,
  jobPlatformKeys,
  jobInspirationIds,
  isMontageJob,
  isReelJob,
} from "@/lib/db";
import { uploadBuffer, publicUrl } from "@/lib/storage";
import { parseBrief, type Brief } from "@/lib/context";
import { generateImage, editImage, enqueueVideo } from "@/lib/fal";
import { finishImage } from "@/lib/finish";
import { finishVideo } from "@/lib/finishVideo";
import { buildMontageMaster, normalizeMotion, endCtaFor, muxMusicIntoVideo, type MontageShot } from "@/lib/montage";
import { platformOf, clampCarousel, reelShotCount, MASTER_IMAGE_SIZE, MASTER_ASPECT, type Platform, type LogoPosition } from "@/lib/platform";
import { BASE_NEGATIVE } from "@/lib/style";

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
  const brief: Brief | null = briefRow ? parseBrief(briefRow.content) : null;
  // Briefs are mode-specific: a montage brief is a curation plan, not a render
  // prompt. Never cross the streams when the user switched video modes.
  const briefIsMontage = (briefRow?.model ?? "").includes("+montage");

  const platforms: Platform[] = jobPlatformKeys(job).map(platformOf);
  if (!platforms.length) {
    return NextResponse.json({ error: "Pick at least one channel to export to." }, { status: 400 });
  }

  // Guard against a double-submit: a second click while clips are still
  // rendering/assembling would enqueue a whole extra set of masters (paid) and
  // muddle the assembly. Clear the results first to start over deliberately.
  const inFlight = (await listRenders(jobId)).filter((r) =>
    ["queued", "processing", "finishing", "assembling"].includes(r.status),
  );
  if (inFlight.length) {
    return NextResponse.json(
      { error: "This job is still rendering. Wait for it to finish, or clear the results to start over." },
      { status: 409 },
    );
  }

  const brand = await getBrandKit(job.project_id);
  // resolve the logo variation: the one chosen on the job, else the project default.
  let logoPath = brand?.logo_path ?? null;
  if (job.logo_id) {
    const l = await getLogo(job.logo_id);
    if (l) logoPath = l.path;
  }
  const logoOpts = {
    logoPath,
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

  // Inspiration references — appended to the Kontext inputs as STYLE guides.
  // The role preamble tells the model which images are content vs. style.
  const inspirationAssets = (await getAssetsByIds(jobInspirationIds(job))).filter((a) => a.media !== "video");
  const refUrls = inspirationAssets.map((a) => a.local_path);
  const refBorrow =
    inspirationAssets
      .map((a) => a.notes?.trim())
      .filter(Boolean)
      .join("; ") || "their color grade, lighting, composition and overall mood";
  const refRole = (baseCount: number): string => {
    if (!refUrls.length) return "";
    const base =
      baseCount === 1
        ? "The FIRST image is the photo to edit — preserve its real people, subject and scene."
        : `The FIRST ${baseCount} images are the photos to work on — preserve their real people, subjects and scenes.`;
    const refs =
      refUrls.length === 1
        ? "The LAST image is a style reference ONLY"
        : `The LAST ${refUrls.length} images are style references ONLY`;
    return `${base} ${refs}: match ${refBorrow}; never copy the reference's people, products, text or logos. `;
  };

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
          const urls = [...imageAssets.map((a) => a.local_path), ...refUrls];
          const editPrompt = optimized
            ? `${refRole(imageAssets.length)}Combine the photos into one balanced, on-brand composition. ${instruction}`
            : `${refRole(imageAssets.length)}Edit and combine the photos on-brand, keep the real subjects. ${instruction} ${brandHint}`;
          const master = await fetchBuf((await editImage(editPrompt, urls, MASTER_ASPECT)).url);
          await fanOutImage(master, 0, null, { mode: "optimize", combined: imageAssets.length, refs: refUrls.length });
        } else {
          const editPrompt = optimized
            ? `${refRole(1)}${instruction}`
            : `${refRole(1)}Edit and enhance this photo on-brand, keep the real subject. ${instruction} ${brandHint}`;
          for (let i = 0; i < imageAssets.length; i++) {
            try {
              const master = await fetchBuf((await editImage(editPrompt, [imageAssets[i].local_path, ...refUrls], MASTER_ASPECT)).url);
              await fanOutImage(master, i, imageAssets[i].id, { mode: "optimize", asset_id: imageAssets[i].id, refs: refUrls.length });
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
            // shot.prompt is already a complete, brand-infused production prompt — use it
            // verbatim. With inspiration references, route through the edit model so the
            // renderer SEES the style it should produce in.
            const master = refUrls.length
              ? await fetchBuf(
                  (
                    await editImage(
                      `Create a brand-new image (a fresh scene, not an edit of the reference). The attached image${refUrls.length === 1 ? " is a style reference" : "s are style references"} ONLY: match ${refBorrow}; never copy the reference's people, products, text or logos. ${shot.prompt}`,
                      refUrls,
                      MASTER_ASPECT,
                    )
                  ).url,
                )
              : await fetchBuf((await generateImage(shot.prompt, MASTER_IMAGE_SIZE)).url);
            await fanOutImage(master, shot.index, null, { mode: "create", caption: shot.caption, refs: refUrls.length });
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
      if (isMontageJob(job)) {
        // Photo montage: real photos → Ken Burns master (no AI render credits),
        // then the standard per-channel crop + logo. Curation comes from the
        // brief when present (selection/order/hold/motion); otherwise every
        // uploaded photo plays for 2.5s with varied motion.
        if (!imageAssets.length) {
          return NextResponse.json({ error: "Upload photos to build the montage from." }, { status: 400 });
        }
        const byId = new Map(imageAssets.map((a) => [a.id, a]));
        let plan: MontageShot[] = [];
        if (briefIsMontage && brief?.shots?.length) {
          const seen = new Set<number>();
          for (let i = 0; i < brief.shots.length; i++) {
            const s = brief.shots[i];
            const a = s.source_asset_id != null ? byId.get(s.source_asset_id) : undefined;
            if (!a || seen.has(a.id)) continue; // only real, unrepeated photos on this job
            seen.add(a.id);
            plan.push({
              imageUrl: a.local_path,
              holdSeconds: s.duration_seconds > 0 ? s.duration_seconds : 2.5,
              motion: normalizeMotion(s.motion, i),
            });
          }
        }
        if (!plan.length) {
          plan = imageAssets.map((a, i) => ({ imageUrl: a.local_path, holdSeconds: 2.5, motion: normalizeMotion(null, i) }));
        }
        // Bound the montage: ≤10 shots and ≤36s of photos, so the master renders
        // within the serverless budget and fits short-video channel caps.
        plan = plan.slice(0, 10);
        const MAX_PHOTO_SECONDS = 36;
        let running = 0;
        plan = plan.filter((p, idx) => {
          const hold = Math.min(Math.max(p.holdSeconds, 1.2), 6);
          if (idx > 0 && running + hold > MAX_PHOTO_SECONDS) return false;
          running += hold;
          return true;
        });
        const END_CARD_SECONDS = 3.0;
        const photoSeconds = running;
        // Closing-card call-to-action: the job's CUSTOM CTA/subtext win (each ad
        // can carry its own offer/number); missing pieces fall back to a
        // goal-aware default. Shared with the Kling path (endCtaFor).
        const customCta = (job.cta_text ?? "").trim();
        const endCta = endCtaFor(job, brand);
        // The card renders with the brand logo when it's on — but a custom CTA
        // earns its card even with the corner logo unchecked (never silently
        // discard what the user typed).
        const cardLogo = logoOpts.logoEnabled && logoOpts.logoPath ? (logoOpts.logoPath as string) : null;
        const withEndCard = Boolean(cardLogo) || Boolean(customCta);
        const master = await buildMontageMaster(plan, {
          music: (job.music_track ?? "").trim() ? ((job.music_track as string).trim().startsWith("assets/") ? publicUrl((job.music_track as string).trim()) : (job.music_track as string).trim()) : null,
          endCard: withEndCard
            ? { logoUrl: cardLogo, bgColor: colors[0] || "#1F3A5F", holdSeconds: END_CARD_SECONDS, cta: endCta.cta, subtext: endCta.sub }
            : null,
        });
        // write the master once, then finish per channel (crop + corner logo)
        const dir = join(tmpdir(), "creative-desk");
        await mkdir(dir, { recursive: true });
        const masterPath = join(dir, `montage-${jobId}-${randomUUID().slice(0, 6)}.mp4`);
        await writeFile(masterPath, master);
        try {
          for (const platform of platforms) {
            try {
              const url = await finishVideoToStorage(masterPath, jobId, 0, platform, {
                ...logoOpts,
                // respect the channel's duration cap (e.g. 60s Reels ads)
                trim: platform.maxDurationSeconds ? { duration: platform.maxDurationSeconds } : undefined,
                // the baked end-card already carries the logo — hide the corner mark there
                logoEnableBefore: withEndCard ? photoSeconds : undefined,
                letterbox: true,
              });
              await insertRender({ group: 0, sourceAssetId: null, platform: platform.key, status: "completed", result_url: url, meta: { mode: "montage", images: plan.length } });
              results.push({ group: 0, platform: platform.key, status: "completed" });
            } catch (e) {
              await insertRender({ group: 0, sourceAssetId: null, platform: platform.key, status: "failed", error: errMsg(e), meta: { mode: "montage" } });
              results.push({ group: 0, platform: platform.key, status: "failed", error: errMsg(e) });
            }
          }
        } finally {
          await unlink(masterPath).catch(() => {});
        }
      } else if (job.intent === "optimize" && job.video_mode === "passthrough") {
        if (!videoAssets.length) {
          return NextResponse.json({ error: "Upload a video to optimize." }, { status: 400 });
        }
        // Enhanced uploads keep their original audio unless a soundtrack was chosen.
        const ptMusicRaw = (job.music_track ?? "").trim();
        const ptMusic = ptMusicRaw ? (ptMusicRaw.startsWith("assets/") ? publicUrl(ptMusicRaw) : ptMusicRaw) : null;
        for (let i = 0; i < videoAssets.length; i++) {
          for (const platform of platforms) {
            try {
              const url = await finishVideoToStorage(videoAssets[i].local_path, jobId, i, platform, logoOpts, ptMusic);
              await insertRender({ group: i, sourceAssetId: videoAssets[i].id, platform: platform.key, status: "completed", result_url: url, meta: { mode: "passthrough" } });
              results.push({ group: i, platform: platform.key, status: "completed" });
            } catch (e) {
              await insertRender({ group: i, sourceAssetId: videoAssets[i].id, platform: platform.key, status: "failed", error: errMsg(e), meta: {} });
              results.push({ group: i, platform: platform.key, status: "failed", error: errMsg(e) });
            }
          }
        }
      } else if (isReelJob(job)) {
        // Cinematic reel: enqueue N textless Kling shots (one per storyboard
        // beat). These masters are NOT fanned out per-platform — the poll route
        // waits for all N to finish, then assembles the captioned, voiced, scored
        // reel per channel (see maybeAssembleReel/assembleReel in the poll route).
        // A reel is built FROM its storyboard brief (captions + narration live
        // there), so require one — never enqueue charged, undifferentiated clips.
        if (!brief || briefIsMontage) {
          return NextResponse.json(
            { error: "Optimize the prompt first — a cinematic reel is built from its storyboard brief (captions + narration come from it)." },
            { status: 400 },
          );
        }
        const shots = brief.shots;
        // Real-photo reel (BEST path): the user uploaded real doctor/clinic
        // photos → animate THOSE (one beat per photo, subject preserved). Else
        // generate the scenes. reelShotCount bounds the generated case; the
        // photo case is bounded by how many photos the brief curated.
        const reelHasPhotos = imageAssets.length > 0;
        const byId = new Map(imageAssets.map((a) => [a.id, a]));
        const n = reelHasPhotos
          ? Math.min(Math.max(shots.length, 1), imageAssets.length)
          : reelShotCount(job);

        // PRESERVE path (default for real photos): don't send the photo through
        // an AI video model at all — the assembler moves the camera over the REAL
        // pixels (Ken Burns), so faces, uniforms and the real embroidered logo
        // stay pixel-perfect. Free, instant, and nothing to poll.
        const preserve = reelHasPhotos && (job.motion_mode ?? "preserve") === "preserve";
        if (preserve) {
          for (let i = 0; i < n; i++) {
            const shot = shots[i] ?? shots[0];
            const a =
              (shot?.source_asset_id != null ? byId.get(shot.source_asset_id) : undefined) ??
              imageAssets[i] ??
              imageAssets[i % imageAssets.length];
            await insertRender({
              group: i,
              sourceAssetId: a.id,
              platform: null,
              status: "completed",
              result_url: a.local_path,
              meta: { reel: true, shot: i, of: n, still: true, motion: normalizeMotion(shot?.motion, i) },
            });
            results.push({ group: i, platform: null, status: "completed" });
          }
          // masters are already complete — the poll route assembles on next tick
          await supabase.from("jobs").update({ status: "submitted", updated_at: new Date().toISOString() }).eq("id", jobId);
          return NextResponse.json({ jobId, intent: job.intent, media: job.media, status: "submitted", submitted: results });
        }
        for (let i = 0; i < n; i++) {
          // Per-shot guard: a mid-loop enqueue failure records a FAILED master
          // (rollupReel then fails the reel cleanly) instead of throwing out of
          // the whole submit and stranding the shots already enqueued.
          try {
            const shot = shots[i] ?? shots[0];
            const optimized = shot?.prompt;
            const motion = shot?.motion ? ` Camera/motion: ${shot.motion}.` : "";
            const instruction = optimized
              ? `${optimized}${motion}`
              : `${job.brief_notes || "An on-brand cinematic dental clip."} ${brandHint}`;
            const seedPrompt = optimized || `${job.brief_notes || "An on-brand cinematic dental clip."} ${brandHint}`;
            let seedUrl: string;
            let seedAssetId: number | null = null;
            if (reelHasPhotos) {
              // Seed from the real photo the brief chose for this beat.
              const a =
                (shot?.source_asset_id != null ? byId.get(shot.source_asset_id) : undefined) ??
                imageAssets[i] ??
                imageAssets[i % imageAssets.length];
              seedUrl = a.local_path;
              seedAssetId = a.id;
            } else {
              seedUrl = (await generateImage(seedPrompt, MASTER_IMAGE_SIZE)).url;
            }
            const negative = shot?.negative || BASE_NEGATIVE;
            const sub = await enqueueVideo(instruction, seedUrl, 5, negative);
            await insertRender({ group: i, sourceAssetId: seedAssetId, platform: null, status: "processing", request_id: sub.requestId, status_url: sub.model, meta: { reel: true, shot: i, of: n } });
            results.push({ group: i, platform: null, status: "processing" });
          } catch (e) {
            await insertRender({ group: i, sourceAssetId: null, platform: null, status: "failed", error: errMsg(e), meta: { reel: true, shot: i, of: n } });
            results.push({ group: i, platform: null, status: "failed", error: errMsg(e) });
            break; // a failed shot fails the reel cleanly (rollupReel → failed)
          }
        }
      } else {
        // Kling path. For a create carousel, enqueue one clip per slide (each its
        // own prompt); otherwise a single clip. A montage curation brief must
        // never become a Kling prompt.
        const shots = briefIsMontage ? [] : brief?.shots ?? [];
        const clips = job.intent === "create" && !briefIsMontage ? clampCarousel(job.carousel_count) : 1;
        const maxDur = Math.max(5, ...platforms.map((p) => p.maxDurationSeconds ?? 5));
        for (let i = 0; i < clips; i++) {
          const shot = shots[i] ?? shots[0];
          const optimized = shot?.prompt;
          const motion = shot?.motion ? ` Camera/motion: ${shot.motion}.` : "";
          const instruction = optimized
            ? `${optimized}${motion}`
            : `${job.brief_notes || "An on-brand promotional clip."} ${brandHint}`;
          const seedPrompt = optimized || `${job.brief_notes || "An on-brand promotional clip."} ${brandHint}`;
          let seedUrl: string;
          let seedAssetId: number | null = null;
          if (imageAssets.length) {
            const a = imageAssets[i] ?? imageAssets[0];
            seedUrl = a.local_path;
            seedAssetId = a.id;
          } else {
            seedUrl = (await generateImage(seedPrompt, MASTER_IMAGE_SIZE)).url;
          }
          const negative = shot?.negative || BASE_NEGATIVE;
          const sub = await enqueueVideo(instruction, seedUrl, maxDur, negative);
          await insertRender({ group: i, sourceAssetId: seedAssetId, platform: null, status: "processing", request_id: sub.requestId, status_url: sub.model, meta: { master: true, slide: i } });
          results.push({ group: i, platform: null, status: "processing" });
        }
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
  logoOpts: {
    logoPath: string | null;
    logoEnabled: boolean;
    logoPosition: LogoPosition;
    trim?: { start?: number; duration?: number };
    logoEnableBefore?: number;
    letterbox?: boolean;
  },
  music?: string | null,
): Promise<string> {
  const dir = join(tmpdir(), "creative-desk");
  await mkdir(dir, { recursive: true });
  const out = join(dir, `${jobId}-${group}-${platform.key}-${randomUUID().slice(0, 6)}.mp4`);
  const withMusic = join(dir, `${jobId}-${group}-${platform.key}-mus-${randomUUID().slice(0, 6)}.mp4`);
  try {
    await finishVideo(inputUrl, out, { platform, ...logoOpts });
    let finalPath = out;
    if (music) {
      // Replace the original audio with the chosen soundtrack; a mux failure
      // keeps the original-audio clip rather than losing the render.
      try {
        await muxMusicIntoVideo(out, withMusic, music);
        finalPath = withMusic;
      } catch (e) {
        console.error("[submit] music mux failed:", e instanceof Error ? e.message : String(e));
      }
    }
    const buf = await readFile(finalPath);
    return await uploadBuffer(`renders/${jobId}-${group}-${platform.key}-${randomUUID().slice(0, 6)}.mp4`, buf, "video/mp4");
  } finally {
    await unlink(out).catch(() => {});
    await unlink(withMusic).catch(() => {});
  }
}
