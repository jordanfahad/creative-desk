import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, unlink, mkdir, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { supabase, getJob, getBrandKit, getLogo, getLatestBrief, jobPlatformKeys, isReelJob, isStudioJob, type Render, type Job } from "@/lib/db";
import { uploadBuffer, publicUrl } from "@/lib/storage";
import { videoStatus, videoResultUrl } from "@/lib/fal";
import { finishVideo } from "@/lib/finishVideo";
import {
  buildEndCardImage, appendEndCard, endCtaFor, muxMusicIntoVideo,
  renderCaptionPng, overlayCaption, concatVideosXfade, assembleVoiceTrack,
  muxVoiceAndMusic, mediaDuration, buildKenBurnsClip, gradeClip, normalizeMotion, extractAudioTrack, overlayTimedCaptions,
} from "@/lib/montage";
import { reelStyle } from "@/lib/reelStyles";
import { assertSpeakerConsent } from "@/lib/talking";
import { parseBrief } from "@/lib/context";
import { synthVoice } from "@/lib/voice";
import { platformOf, type LogoPosition, type Platform } from "@/lib/platform";

export const runtime = "nodejs";
export const maxDuration = 300;

const POLLABLE = new Set(["queued", "processing"]);
const MAX_ATTEMPTS = 90;

export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) return NextResponse.json({ error: "FAL_KEY is not set" }, { status: 500 });

  let body: { jobId?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* optional */
  }
  const jobId = Number(body.jobId);

  const query = supabase.from("renders").select("*");
  const { data } = Number.isFinite(jobId) ? await query.eq("job_id", jobId) : await query;
  const rows = (data as Render[]) ?? [];
  const pending = rows.filter((r) => POLLABLE.has(r.status) && r.request_id && r.status_url);
  const updated: Array<{ id: number; status: string }> = [];

  for (const r of pending) {
    const model = r.status_url as string;
    const requestId = r.request_id as string;
    const attempts = (r.attempts ?? 0) + 1;
    try {
      const status = await videoStatus(model, requestId);
      if (status !== "completed") {
        if (attempts >= MAX_ATTEMPTS) {
          await fail(r.id, "Timed out waiting for the video render.");
          updated.push({ id: r.id, status: "failed" });
        } else {
          await supabase.from("renders").update({ status, attempts, updated_at: new Date().toISOString() }).eq("id", r.id);
          updated.push({ id: r.id, status });
        }
        continue;
      }
      let masterUrl: string | null = null;
      try {
        masterUrl = await videoResultUrl(model, requestId);
      } catch (e) {
        if (!isTransient(e)) {
          await fail(r.id, errMsg(e));
          updated.push({ id: r.id, status: "failed" });
          continue;
        }
      }
      if (!masterUrl) {
        if (attempts >= MAX_ATTEMPTS) {
          await fail(r.id, "Render completed but no video was returned.");
          updated.push({ id: r.id, status: "failed" });
        } else {
          await supabase.from("renders").update({ attempts, updated_at: new Date().toISOString() }).eq("id", r.id);
        }
        continue;
      }
      // Atomically CLAIM the master before the (slow) fan-out so an overlapping
      // poll invocation can't fan out the same master twice — "finishing" is not
      // pollable. Bump attempts in the claim so MAX_ATTEMPTS still bounds crashes.
      const { data: claimed } = await supabase
        .from("renders")
        .update({ status: "finishing", attempts, updated_at: new Date().toISOString() })
        .eq("id", r.id)
        .eq("status", r.status)
        .select("id");
      if (!claimed?.length) continue; // another invocation owns it
      // Reel shots are NOT fanned out per-platform: store the raw silent clip and
      // let the assembly step (after ALL shots finish) stitch the reel.
      if (isReelMaster(r)) {
        // A talking beat is a synthetic likeness of a real person. Consent is
        // re-read from the DB HERE, not trusted from enqueue time — if it was
        // withdrawn (or the person removed) while the model was rendering, the
        // clip must never reach a deliverable.
        if (readMeta(r).talking) {
          try {
            if (r.source_asset_id == null) throw new Error("the speaker is no longer on record");
            await assertSpeakerConsent(r.source_asset_id);
          } catch (e) {
            await fail(r.id, `Speaking consent was withdrawn — this clip was not delivered. ${errMsg(e)}`);
            updated.push({ id: r.id, status: "failed" });
            continue;
          }
        }
        await supabase
          .from("renders")
          .update({ status: "completed", result_url: masterUrl, updated_at: new Date().toISOString() })
          .eq("id", r.id);
        updated.push({ id: r.id, status: "completed" });
        continue;
      }
      try {
        await fanOutVideo(r, masterUrl);
      } catch (e) {
        // release the claim so a later poll can retry (bounded by attempts)
        const nextStatus = attempts >= MAX_ATTEMPTS ? "failed" : "processing";
        await supabase
          .from("renders")
          .update({ status: nextStatus, error: errMsg(e).slice(0, 800), updated_at: new Date().toISOString() })
          .eq("id", r.id);
        updated.push({ id: r.id, status: nextStatus });
        continue;
      }
      await supabase.from("renders").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", r.id);
      updated.push({ id: r.id, status: "completed" });
    } catch (e) {
      if (attempts >= MAX_ATTEMPTS || !isTransient(e)) {
        await fail(r.id, errMsg(e));
        updated.push({ id: r.id, status: "failed" });
      } else {
        await supabase.from("renders").update({ attempts, updated_at: new Date().toISOString() }).eq("id", r.id);
      }
    }
  }

  if (Number.isFinite(jobId)) {
    // A reel's shots finish independently; once they're ALL done, assemble the
    // reel (single-owner claim inside). Runs before the rollup so status stays
    // "submitted" until real deliverables land; the reel gets its own status
    // rollup that understands the assembly lifecycle.
    const job = await getJob(jobId);
    if (job && isReelJob(job)) {
      await maybeAssembleReel(job);
      await rollupReel(job);
    } else if (job && isStudioJob(job)) {
      await maybeFinishStudio(job);
      await rollupJob(jobId);
    } else {
      await rollupJob(jobId);
    }
  }
  return NextResponse.json({ polled: pending.length, updated });
}

async function fanOutVideo(master: Render, masterUrl: string) {
  const job = await getJob(master.job_id);
  if (!job) return;
  const brand = await getBrandKit(job.project_id);
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
  const platforms = jobPlatformKeys(job).map(platformOf);
  const dir = join(tmpdir(), "creative-desk");
  await mkdir(dir, { recursive: true });

  // Closing CTA card for AI clips — same rule as montage: the brand logo earns a
  // card, and a custom CTA earns one even with the corner logo off.
  const customCta = (job.cta_text ?? "").trim();
  const cardLogo = logoOpts.logoEnabled && logoOpts.logoPath ? logoOpts.logoPath : null;
  const wantCard = Boolean(cardLogo) || Boolean(customCta);
  const endCta = endCtaFor(job, brand);
  // Soundtrack applies to AI clips too — preset key, or the uploaded track's URL.
  const musicRaw = (job.music_track ?? "").trim();
  const musicChoice = musicRaw ? (musicRaw.startsWith("assets/") ? publicUrl(musicRaw) : musicRaw) : null;
  let colors: string[] = [];
  try {
    const v = JSON.parse(brand?.colors || "[]");
    if (Array.isArray(v)) colors = v.map(String);
  } catch {
    /* ignore */
  }

  const group = master.shot_index; // carousel slide index (0 for a single clip)
  // A retried fan-out (claim released after a mid-loop crash) must not duplicate
  // deliverables that already landed — skip platforms with a completed row.
  const { data: existing } = await supabase
    .from("renders")
    .select("platform")
    .eq("job_id", job.id)
    .eq("shot_index", group)
    .eq("status", "completed")
    .not("platform", "is", null);
  const done = new Set((existing ?? []).map((e) => e.platform as string));

  for (const platform of platforms) {
    if (done.has(platform.key)) continue;
    try {
      const out = join(dir, `${job.id}-${group}-${platform.key}-${randomUUID().slice(0, 6)}.mp4`);
      await finishVideo(masterUrl, out, { platform, ...logoOpts });
      // Append the CTA card at exact channel dimensions (crossfade). A card
      // failure falls back to the plain clip — never lose the render.
      let finalPath = out;
      if (wantCard) {
        const uid = randomUUID().slice(0, 6);
        const cardPath = join(dir, `card-${job.id}-${platform.key}-${uid}.jpg`);
        const withCard = join(dir, `${job.id}-${group}-${platform.key}-cta-${uid}.mp4`);
        try {
          const cardPng = await buildEndCardImage(platform.w, platform.h, {
            logoUrl: cardLogo,
            bgColor: colors[0],
            cta: endCta.cta,
            subtext: endCta.sub,
          });
          await writeFile(cardPath, cardPng);
          await appendEndCard(out, cardPath, withCard, platform.w, platform.h);
          finalPath = withCard;
        } catch (e) {
          console.error("[poll] end-card append failed:", e instanceof Error ? e.message : String(e));
          await unlink(withCard).catch(() => {});
        } finally {
          await unlink(cardPath).catch(() => {});
        }
      }
      // Bake the soundtrack in (video stream copied — cheap). Failure keeps the
      // silent clip rather than losing the render.
      if (musicChoice) {
        const withMusic = join(dir, `${job.id}-${group}-${platform.key}-mus-${randomUUID().slice(0, 6)}.mp4`);
        try {
          await muxMusicIntoVideo(finalPath, withMusic, musicChoice);
          if (finalPath !== out) await unlink(finalPath).catch(() => {});
          finalPath = withMusic;
        } catch (e) {
          console.error("[poll] music mux failed:", e instanceof Error ? e.message : String(e));
          await unlink(withMusic).catch(() => {});
        }
      }
      const buf = await readFile(finalPath);
      const url = await uploadBuffer(`renders/${job.id}-${group}-${platform.key}-${randomUUID().slice(0, 6)}.mp4`, buf, "video/mp4");
      await unlink(out).catch(() => {});
      if (finalPath !== out) await unlink(finalPath).catch(() => {});
      await supabase.from("renders").insert({
        job_id: job.id, brief_id: master.brief_id, shot_index: group,
        source_asset_id: master.source_asset_id, platform: platform.key,
        status: "completed", result_url: url, attempts: 0, meta: JSON.stringify({ master_url: masterUrl }),
      });
    } catch (e) {
      await supabase.from("renders").insert({
        job_id: job.id, brief_id: master.brief_id, shot_index: group, platform: platform.key,
        status: "failed", error: errMsg(e), attempts: 0, meta: "{}",
      });
    }
  }
}

function readMeta(r: Render): Record<string, unknown> {
  try {
    return JSON.parse(r.meta || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}
function isReelMaster(r: Render): boolean {
  return Boolean(readMeta(r).reel);
}

// Reel shots are the platform-null meta.reel masters, ordered by shot_index.
// A job can hold masters from MORE THAN ONE submission (a re-submit, or a retry
// after a failure). Only the LATEST batch is the reel: take the newest row per
// shot_index and keep exactly the shots that batch declared (meta.of), so stale
// masters from an earlier submit can never pad or deadlock the assembly.
async function loadReelMasters(jobId: number): Promise<Render[]> {
  const { data } = await supabase
    .from("renders")
    .select("*")
    .eq("job_id", jobId)
    .is("platform", null)
    .order("id", { ascending: false });
  const all = ((data as Render[]) ?? []).filter(isReelMaster);
  if (!all.length) return [];
  // newest row wins per shot index (rows are already newest-first)
  const bySlot = new Map<number, Render>();
  for (const r of all) if (!bySlot.has(r.shot_index)) bySlot.set(r.shot_index, r);
  const newest = all[0];
  const expected = Number(readMeta(newest).of) || bySlot.size;
  return Array.from(bySlot.values())
    .filter((r) => r.shot_index < expected)
    .sort((a, b) => a.shot_index - b.shot_index);
}
// Platforms that already have a COMPLETED reel deliverable (failed ones don't count).
async function deliveredReelPlatforms(jobId: number): Promise<Set<string>> {
  const { data } = await supabase
    .from("renders")
    .select("platform")
    .eq("job_id", jobId)
    .eq("shot_index", 0)
    .eq("status", "completed")
    .not("platform", "is", null);
  return new Set((data ?? []).map((d) => d.platform as string));
}
// Max assembly attempts before a reel is declared failed (separate from the
// per-shot render attempts; tracked in shot-0's meta so it survives releases).
// One reel beat. Real uploaded clips are trimmed to this so a long phone video
// can't swallow the reel; Ken Burns stills are built at this length too.
const BEAT_SECONDS = 5;
const MAX_ASSEMBLY_ATTEMPTS = 4;
// A crashed assembly can't run its release, leaving shot-0 stuck "assembling".
// Any claim older than this window (well beyond the 300s function budget) is
// treated as dead and may be re-taken. A live assembly keeps updated_at fresh,
// so a concurrent poll still can't steal it — the single-owner invariant holds.
const ASSEMBLY_STALE_MS = 6 * 60 * 1000;

/**
 * Assemble a cinematic reel once all its shots have rendered. Single-owner claim
 * on shot-0 (completed → assembling) so overlapping polls can't double-assemble.
 * The claim is TIME-BOUNDED: a claim stranded by a crash/timeout self-heals once
 * it goes stale. Assembly attempts are bounded (MAX_ASSEMBLY_ATTEMPTS); rollupReel
 * turns an exhausted/failed reel terminal so the client poller isn't left spinning.
 */
async function maybeAssembleReel(job: Job) {
  const masters = await loadReelMasters(job.id);
  if (!masters.length) return;
  // A terminally-failed shot can never be stitched — rollupReel marks the reel
  // failed; don't attempt (and don't deadlock waiting for it to "complete").
  if (masters.some((m) => m.status === "failed")) return;
  // SECOND consent gate: a talking master may already be "completed" when
  // consent is withdrawn, so re-check before stitching/publishing anything.
  // Nothing containing a withdrawn likeness may become a deliverable.
  for (const m of masters) {
    if (!readMeta(m).talking) continue;
    try {
      if (m.source_asset_id == null) throw new Error("the speaker is no longer on record");
      await assertSpeakerConsent(m.source_asset_id);
    } catch (e) {
      await fail(m.id, `Speaking consent was withdrawn — this reel was not assembled. ${errMsg(e)}`);
      return;
    }
  }
  // Every shot must have a clip (completed, or shot-0 mid/stale-assembling). A
  // still-rendering shot (queued/processing) means we're not ready yet.
  const ready = masters.every(
    (m) => m.result_url && (m.status === "completed" || m.status === "assembling"),
  );
  if (!ready) return;

  const platforms = jobPlatformKeys(job).map(platformOf);
  const done = await deliveredReelPlatforms(job.id);
  const remaining = platforms.filter((p) => !done.has(p.key));
  const shot0 = masters[0];
  if (!remaining.length) {
    // fully delivered — clear any stranded assembling lock and stop
    if (shot0.status === "assembling") {
      await supabase.from("renders").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", shot0.id);
    }
    return;
  }

  // Bound the retries (assembly attempts live in shot-0's meta so they persist
  // across claim releases, separate from the render-poll `attempts`).
  const meta0 = readMeta(shot0);
  const asm = Number(meta0.asmAttempts) || 0;
  if (asm >= MAX_ASSEMBLY_ATTEMPTS) return; // exhausted → rollupReel marks failed

  // Atomic single-owner claim on shot-0: fresh "completed" OR a stale "assembling".
  const staleBefore = new Date(Date.now() - ASSEMBLY_STALE_MS).toISOString();
  const nextMeta = JSON.stringify({ ...meta0, asmAttempts: asm + 1 });
  const { data: claimed, error: claimErr } = await supabase
    .from("renders")
    .update({ status: "assembling", meta: nextMeta, updated_at: new Date().toISOString() })
    .eq("id", shot0.id)
    .or(`status.eq.completed,and(status.eq.assembling,updated_at.lt.${staleBefore})`)
    .select("id");
  // A malformed filter/DB error must be visible, not silently look like "lost the race".
  if (claimErr) {
    console.error("[reel] claim query errored:", claimErr.message ?? claimErr);
    return;
  }
  if (!claimed?.length) return; // another poll owns the assembly (fresh claim)

  try {
    // Clear stale FAILED deliverables so a retried platform is rebuilt cleanly
    // and rows don't accumulate across attempts.
    await supabase
      .from("renders")
      .delete()
      .eq("job_id", job.id)
      .eq("shot_index", 0)
      .eq("status", "failed")
      .not("platform", "is", null);
    await assembleReel(job, masters, remaining);
  } catch (e) {
    console.error("[reel] assembly failed:", e instanceof Error ? (e.stack ?? e.message) : String(e));
  } finally {
    // release the claim → a completed master (platform null, NOT a deliverable)
    await supabase
      .from("renders")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", shot0.id);
  }
}

/**
 * Reel-aware status rollup. Understands the assembly lifecycle so the client
 * poller (which runs only while status==="submitted") isn't stopped prematurely:
 * a reel stays "submitted" while shots render OR while assembly is still viable,
 * becomes "done" once a channel is delivered, and only "failed" when a shot
 * failed to render or assembly exhausted its attempts with nothing delivered.
 */
async function rollupReel(job: Job) {
  const masters = await loadReelMasters(job.id);
  if (!masters.length) return rollupJob(job.id);
  const platforms = jobPlatformKeys(job).map(platformOf);
  const done = await deliveredReelPlatforms(job.id);

  let status: string;
  if (masters.some((m) => m.status === "failed")) {
    status = "failed";
  } else if (masters.some((m) => m.status === "queued" || m.status === "processing")) {
    status = "submitted"; // shots still rendering
  } else {
    // all shots ready (completed / assembling)
    const asm = Number(readMeta(masters[0]).asmAttempts) || 0;
    if (done.size >= platforms.length) status = "done";
    else if (asm >= MAX_ASSEMBLY_ATTEMPTS) status = done.size > 0 ? "done" : "failed";
    else status = "submitted"; // assembly still viable → keep polling
  }
  await supabase.from("jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", job.id);
}

async function assembleReel(job: Job, masters: Render[], platforms: Platform[]) {
  const brand = await getBrandKit(job.project_id);
  const brief = parseBrief((await getLatestBrief(job.id))?.content ?? null);
  const shotsMeta = brief?.shots ?? [];

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
  let colors: string[] = [];
  try {
    const v = JSON.parse(brand?.colors || "[]");
    if (Array.isArray(v)) colors = v.map(String);
  } catch {
    /* ignore */
  }
  const endCta = endCtaFor(job, brand);
  const style = reelStyle(job.reel_style);
  const cardLogo = logoOpts.logoEnabled && logoOpts.logoPath ? (logoOpts.logoPath as string) : null;
  const musicRaw = (job.music_track ?? "").trim();
  const musicChoice = musicRaw ? (musicRaw.startsWith("assets/") ? publicUrl(musicRaw) : musicRaw) : null;
  const voEnabled = job.voiceover_enabled === 1;

  const dir = join(tmpdir(), `cd-reel-${job.id}-${randomUUID().slice(0, 6)}`);
  await mkdir(dir, { recursive: true });

  // Synthesize the voiceover ONCE (dimension-independent) and reuse per platform.
  // A TALKING beat is special: its lips were synced to a specific audio take, so
  // we take the narration straight OFF that clip instead of re-synthesizing (a
  // second take would drift out of sync, or go mute if VO were off).
  const voPaths: (string | null)[] = [];
  for (let i = 0; i < masters.length; i++) {
    if (!readMeta(masters[i]).talking) {
      voPaths.push(null);
      continue;
    }
    const p = join(dir, `talkvo-${i}.m4a`);
    try {
      const secs = await mediaDuration(masters[i].result_url as string);
      voPaths[i] = await extractAudioTrack(masters[i].result_url as string, p, secs);
    } catch (e) {
      console.error("[reel] talking audio extract failed:", e instanceof Error ? e.message : String(e));
      voPaths[i] = null;
    }
  }
  if (voEnabled) {
    for (let i = 0; i < masters.length; i++) {
      if (voPaths[i]) continue; // talking beat already carries its real audio
      const line = (shotsMeta[i]?.voiceover ?? "").trim();
      if (!line) {
        voPaths[i] = null;
        continue;
      }
      try {
        const mp3 = await synthVoice(line, job.vo_voice ?? undefined);
        const p = join(dir, `vo-${i}.mp3`);
        await writeFile(p, mp3);
        voPaths[i] = p;
      } catch (e) {
        console.error("[reel] VO synth failed for shot", i, e instanceof Error ? e.message : String(e));
        voPaths[i] = null;
      }
    }
  }

  try {
    for (const platform of platforms) {
      const uid = randomUUID().slice(0, 6);
      try {
        // 1 · build each shot at platform dims, then burn its caption.
        //     A "still" master is a REAL photo — move the camera over the actual
        //     pixels (Ken Burns) so the real face/uniform/logo stay pixel-perfect.
        //     A video master is finished (crop + corner logo) as usual.
        const shotClips: string[] = [];
        for (let i = 0; i < masters.length; i++) {
          const src = masters[i].result_url as string;
          const mmeta = readMeta(masters[i]);
          const fin = join(dir, `s-${platform.key}-${i}-${uid}.mp4`);
          if (mmeta.still) {
            const kb = join(dir, `kb-${platform.key}-${i}-${uid}.mp4`);
            await buildKenBurnsClip(
              src, kb, platform.w, platform.h, 5,
              normalizeMotion(typeof mmeta.motion === "string" ? mmeta.motion : null, i),
              style.grade,
            );
            // Ken Burns writes raw frames — run it through finishVideo so the
            // corner brand mark is stamped exactly like every other clip.
            if (logoOpts.logoEnabled && logoOpts.logoPath) {
              await finishVideo(kb, fin, { platform, ...logoOpts });
              await unlink(kb).catch(() => {});
            } else {
              await rename(kb, fin);
            }
          } else {
            // A real uploaded clip can be any length — trim it to a beat so one
            // long phone video doesn't swallow the whole reel. A TALKING beat is
            // never trimmed: its lips are synced to the whole spoken line, and
            // the voiceover track plays that same line in full.
            const trim = mmeta.clip && !mmeta.talking ? { duration: BEAT_SECONDS } : undefined;
            await finishVideo(src, fin, { platform, ...logoOpts, trim });
            if (style.grade) {
              const g = join(dir, `g-${platform.key}-${i}-${uid}.mp4`);
              try {
                await gradeClip(fin, g, style.grade);
                await unlink(fin).catch(() => {});
                await rename(g, fin);
              } catch (e) {
                console.error("[reel] grade failed:", e instanceof Error ? e.message : String(e));
              }
            }
          }
          const caption = (shotsMeta[i]?.caption ?? "").trim();
          if (caption) {
            const png = join(dir, `cap-${platform.key}-${i}-${uid}.png`);
            await writeFile(
              png,
              await renderCaptionPng(caption, platform.w, platform.h, {
                upper: style.caption.upper,
                size: style.caption.size,
                position: style.caption.position,
                fill: style.caption.color,
                scrim: style.caption.scrim,
              }),
            );
            const capped = join(dir, `sc-${platform.key}-${i}-${uid}.mp4`);
            await overlayCaption(fin, png, capped, { fadeInAt: 0.35 });
            shotClips.push(capped);
          } else {
            shotClips.push(fin);
          }
        }
        // 2 · concat with crossfades (returns per-shot offsets for VO alignment)
        const silent = join(dir, `reel-${platform.key}-${uid}.mp4`);
        const { offsets } = await concatVideosXfade(shotClips, silent, platform.w, platform.h, style.crossfade);

        // 3 · append the CTA end-card (silent; appendEndCard is -an). Audio is
        //     built to the card-inclusive length next so music/VO span the card.
        let videoForAudio = silent;
        try {
          const cardPng = await buildEndCardImage(platform.w, platform.h, {
            logoUrl: cardLogo,
            bgColor: colors[0],
            cta: endCta.cta,
            subtext: endCta.sub,
          });
          const cardPath = join(dir, `card-${platform.key}-${uid}.jpg`);
          await writeFile(cardPath, cardPng);
          const withCard = join(dir, `reelc-${platform.key}-${uid}.mp4`);
          await appendEndCard(silent, cardPath, withCard, platform.w, platform.h, 3.0);
          videoForAudio = withCard;
        } catch (e) {
          console.error("[reel] end-card failed:", e instanceof Error ? e.message : String(e));
        }

        // 4 · build audio to the FULL (card-inclusive) duration and mux
        const fullSeconds = await mediaDuration(videoForAudio);
        let voTrack: string | null = null;
        // Build the track whenever ANY beat has audio — a talking beat carries
        // the doctor's own delivery even when narration is switched off.
        if (voPaths.some(Boolean)) {
          try {
            const vt = join(dir, `vot-${platform.key}-${uid}.m4a`);
            await assembleVoiceTrack(voPaths, offsets, fullSeconds, vt);
            voTrack = vt;
          } catch (e) {
            console.error("[reel] VO track failed:", e instanceof Error ? e.message : String(e));
          }
        }
        let finalPath = videoForAudio;
        if (voTrack || musicChoice) {
          finalPath = join(dir, `final-${platform.key}-${uid}.mp4`);
          await muxVoiceAndMusic(videoForAudio, voTrack, musicChoice, finalPath);
        }

        const buf = await readFile(finalPath);
        const url = await uploadBuffer(
          `renders/${job.id}-0-${platform.key}-${randomUUID().slice(0, 6)}.mp4`,
          buf,
          "video/mp4",
        );
        await supabase.from("renders").insert({
          job_id: job.id, brief_id: masters[0].brief_id, shot_index: 0,
          source_asset_id: null, platform: platform.key,
          status: "completed", result_url: url, attempts: 0,
          meta: JSON.stringify({ reel: true, shots: masters.length }),
        });
      } catch (e) {
        await supabase.from("renders").insert({
          job_id: job.id, brief_id: masters[0].brief_id, shot_index: 0, platform: platform.key,
          status: "failed", error: errMsg(e), attempts: 0, meta: "{}",
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * STUDIO FINISH — finish the clinic's own footage for ONE channel per poll
 * invocation. Doing every channel in one request blew the serverless budget, so
 * each tick claims the master, delivers a single channel, and releases; the
 * client's 10s poll drains the rest and the whole thing self-heals.
 */
async function maybeFinishStudio(job: Job) {
  const { data } = await supabase
    .from("renders")
    .select("*")
    .eq("job_id", job.id)
    .is("platform", null)
    .order("id", { ascending: false })
    .limit(1);
  const master = ((data as Render[]) ?? [])[0];
  if (!master || !readMeta(master).studio || !master.result_url) return;

  const platforms = jobPlatformKeys(job).map(platformOf);
  const { data: done } = await supabase
    .from("renders")
    .select("platform")
    .eq("job_id", job.id)
    .eq("status", "completed")
    .not("platform", "is", null);
  const doneKeys = new Set((done ?? []).map((d) => d.platform as string));
  const next = platforms.find((p) => !doneKeys.has(p.key));
  if (!next) return; // every channel delivered

  // single-owner claim (same stale-reclaim idiom as the reel assembler)
  const staleBefore = new Date(Date.now() - ASSEMBLY_STALE_MS).toISOString();
  const { data: claimed } = await supabase
    .from("renders")
    .update({ status: "assembling", updated_at: new Date().toISOString() })
    .eq("id", master.id)
    .or(`status.eq.completed,and(status.eq.assembling,updated_at.lt.${staleBefore})`)
    .select("id");
  if (!claimed?.length) return;

  const meta = readMeta(master);
  const cues = (Array.isArray(meta.cues) ? meta.cues : []) as Array<{ start: number; end: number; text: string }>;
  const maxSeconds = Number(meta.maxSeconds) || 60;
  const brand = await getBrandKit(job.project_id);
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
  let colors: string[] = [];
  try {
    const v = JSON.parse(brand?.colors || "[]");
    if (Array.isArray(v)) colors = v.map(String);
  } catch {
    /* ignore */
  }
  const style = reelStyle(job.reel_style);
  const endCta = endCtaFor(job, brand);
  const cardLogo = logoOpts.logoEnabled && logoOpts.logoPath ? (logoOpts.logoPath as string) : null;
  const wantCard = Boolean(cardLogo) || Boolean((job.cta_text ?? "").trim());
  const musicRaw = (job.music_track ?? "").trim();
  const music = musicRaw ? (musicRaw.startsWith("assets/") ? publicUrl(musicRaw) : musicRaw) : null;

  const dir = join(tmpdir(), `cd-studio-${job.id}-${randomUUID().slice(0, 6)}`);
  await mkdir(dir, { recursive: true });
  try {
    const uid = randomUUID().slice(0, 6);
    const base = join(dir, `b-${uid}.mp4`);
    const capd = join(dir, `c-${uid}.mp4`);
    const withCard = join(dir, `w-${uid}.mp4`);
    const finalP = join(dir, `f-${uid}.mp4`);
    const voP = join(dir, `v-${uid}.m4a`);
    const src = master.result_url as string;
    const srcSecs = await mediaDuration(src).catch(() => maxSeconds);
    const outSeconds = Math.min(next.maxDurationSeconds || maxSeconds, maxSeconds, srcSecs);

    await finishVideo(src, base, { platform: next, ...logoOpts, trim: { duration: outSeconds } });
    let cur = base;
    const visible = cues
      .filter((c) => c.start < outSeconds - 0.2)
      .slice(0, 40)
      .map((c) => ({ ...c, end: Math.min(c.end, outSeconds) }));
    if (visible.length) {
      const timed: { png: string; start: number; end: number }[] = [];
      for (let i = 0; i < visible.length; i++) {
        const p = join(dir, `p-${uid}-${i}.png`);
        await writeFile(p, await renderCaptionPng(visible[i].text, next.w, next.h, {
          upper: style.caption.upper, size: style.caption.size,
          position: style.caption.position, fill: style.caption.color, scrim: style.caption.scrim,
        }));
        timed.push({ png: p, start: visible[i].start, end: visible[i].end });
      }
      await overlayTimedCaptions(base, timed, capd);
      cur = capd;
    }
    // The real voice must survive the (video-only) end card.
    let speech: string | null = null;
    if (wantCard) {
      const cardPng = await buildEndCardImage(next.w, next.h, {
        logoUrl: cardLogo, bgColor: colors[0], cta: endCta.cta, subtext: endCta.sub,
      });
      const cardPath = join(dir, `card-${uid}.jpg`);
      await writeFile(cardPath, cardPng);
      await appendEndCard(cur, cardPath, withCard, next.w, next.h, 3.0);
      speech = await extractAudioTrack(cur, voP, await mediaDuration(withCard));
      cur = withCard;
    } else {
      speech = await extractAudioTrack(cur, voP, await mediaDuration(cur));
    }
    if (speech || music) {
      await muxVoiceAndMusic(cur, speech, music, finalP);
      cur = finalP;
    }
    const buf = await readFile(cur);
    const url = await uploadBuffer(`renders/${job.id}-0-${next.key}-${randomUUID().slice(0, 6)}.mp4`, buf, "video/mp4");
    await supabase.from("renders").insert({
      job_id: job.id, brief_id: master.brief_id, shot_index: 0,
      source_asset_id: master.source_asset_id, platform: next.key,
      status: "completed", result_url: url, attempts: 0,
      meta: JSON.stringify({ mode: "studio", cues: visible.length }),
    });
  } catch (e) {
    console.error("[studio] finish failed:", e instanceof Error ? (e.stack ?? e.message) : String(e));
    await supabase.from("renders").insert({
      job_id: job.id, brief_id: master.brief_id, shot_index: 0, platform: next.key,
      status: "failed", error: errMsg(e), attempts: 0, meta: "{}",
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await supabase
      .from("renders")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", master.id);
  }
}

async function fail(id: number, error: string) {
  await supabase.from("renders").update({ status: "failed", error: error.slice(0, 800), updated_at: new Date().toISOString() }).eq("id", id);
}

async function rollupJob(jobId: number) {
  const { data } = await supabase.from("renders").select("status, platform").eq("job_id", jobId);
  const rows = (data as { status: string; platform: string | null }[]) ?? [];
  if (!rows.length) return;
  // platform-null rows are internal masters (Kling clip / reel shot), NOT
  // deliverables — and "finishing"/"assembling" are in-flight. A job is only
  // "done" once a real per-platform deliverable exists; while masters are still
  // finishing or a reel is assembling, keep it "submitted" so the client polls on.
  const inFlight = rows.filter((r) =>
    ["queued", "processing", "finishing", "assembling"].includes(r.status),
  ).length;
  const doneDeliverables = rows.filter((r) => r.status === "completed" && r.platform).length;
  const status = inFlight > 0 ? "submitted" : doneDeliverables > 0 ? "done" : "failed";
  await supabase.from("jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", jobId);
}

function isTransient(e: unknown): boolean {
  const m = errMsg(e).toLowerCase();
  return m.includes("fetch") || m.includes("network") || m.includes("timeout") || m.includes("econn") || m.includes("502") || m.includes("503") || m.includes("504");
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
