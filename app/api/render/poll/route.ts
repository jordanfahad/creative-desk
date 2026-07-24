import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { supabase, getJob, getBrandKit, getLogo, jobPlatformKeys, type Render } from "@/lib/db";
import { uploadBuffer } from "@/lib/storage";
import { videoStatus, videoResultUrl } from "@/lib/fal";
import { finishVideo } from "@/lib/finishVideo";
import { buildEndCardImage, appendEndCard, endCtaFor } from "@/lib/montage";
import { platformOf, type LogoPosition } from "@/lib/platform";

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

  if (Number.isFinite(jobId)) await rollupJob(jobId);
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

async function fail(id: number, error: string) {
  await supabase.from("renders").update({ status: "failed", error: error.slice(0, 800), updated_at: new Date().toISOString() }).eq("id", id);
}

async function rollupJob(jobId: number) {
  const { data } = await supabase.from("renders").select("status").eq("job_id", jobId);
  const rows = (data as { status: string }[]) ?? [];
  if (!rows.length) return;
  const pending = rows.filter((r) => r.status === "queued" || r.status === "processing").length;
  const done = rows.filter((r) => r.status === "completed").length;
  const status = pending > 0 ? "submitted" : done > 0 ? "done" : "failed";
  await supabase.from("jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", jobId);
}

function isTransient(e: unknown): boolean {
  const m = errMsg(e).toLowerCase();
  return m.includes("fetch") || m.includes("network") || m.includes("timeout") || m.includes("econn") || m.includes("502") || m.includes("503") || m.includes("504");
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
