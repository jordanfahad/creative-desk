import { NextRequest, NextResponse } from "next/server";
import { readFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { supabase, getJob, getBrandKit, jobPlatformKeys, type Render } from "@/lib/db";
import { uploadBuffer } from "@/lib/storage";
import { videoStatus, videoResultUrl } from "@/lib/fal";
import { finishVideo } from "@/lib/finishVideo";
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
      await fanOutVideo(r, masterUrl);
      await supabase.from("renders").update({ status: "completed", attempts, updated_at: new Date().toISOString() }).eq("id", r.id);
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
  const brand = await getBrandKit();
  const logoOpts = {
    logoPath: brand?.logo_path ?? null,
    logoEnabled: job.logo_enabled === 1,
    logoPosition: (job.logo_position as LogoPosition) || "bottom-right",
  };
  const platforms = jobPlatformKeys(job).map(platformOf);
  const dir = join(tmpdir(), "creative-desk");
  await mkdir(dir, { recursive: true });

  for (const platform of platforms) {
    try {
      const out = join(dir, `${job.id}-0-${platform.key}-${randomUUID().slice(0, 6)}.mp4`);
      await finishVideo(masterUrl, out, { platform, ...logoOpts });
      const buf = await readFile(out);
      const url = await uploadBuffer(`renders/${job.id}-0-${platform.key}-${randomUUID().slice(0, 6)}.mp4`, buf, "video/mp4");
      await unlink(out).catch(() => {});
      await supabase.from("renders").insert({
        job_id: job.id, brief_id: master.brief_id, shot_index: 0,
        source_asset_id: master.source_asset_id, platform: platform.key,
        status: "completed", result_url: url, attempts: 0, meta: JSON.stringify({ master_url: masterUrl }),
      });
    } catch (e) {
      await supabase.from("renders").insert({
        job_id: job.id, brief_id: master.brief_id, shot_index: 0, platform: platform.key,
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
