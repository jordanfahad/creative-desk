import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { db, getJob, getBrandKit, jobPlatformKeys, assetWebPath, type Render } from "@/lib/db";
import { videoStatus, videoResultUrl } from "@/lib/fal";
import { finishVideo } from "@/lib/finishVideo";
import { platformOf, type LogoPosition } from "@/lib/platform";

export const runtime = "nodejs";

// Polls fal video masters. When a master clip completes, download it and fan out
// ffmpeg-finished deliverables (crop + logo) to every channel the job selected.
// Terminal failures and timeouts are marked 'failed' so a job can never hang.

const STORAGE_ROOT = resolve(process.env.CREATIVE_DESK_STORAGE || "./storage");
const POLLABLE = new Set(["queued", "processing"]);
const MAX_ATTEMPTS = 90; // ~15 min at a 10s cadence

export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: "FAL_KEY is not set in .env.local" }, { status: 500 });
  }

  let body: { jobId?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* optional body */
  }

  const jobId = Number(body.jobId);
  const rows = (
    Number.isFinite(jobId)
      ? db.prepare("SELECT * FROM renders WHERE job_id = ?").all(jobId)
      : db.prepare("SELECT * FROM renders").all()
  ) as Render[];

  // Only video masters are polled (image deliverables complete synchronously).
  const pending = rows.filter((r) => POLLABLE.has(r.status) && r.request_id && r.status_url);
  const rendersDir = join(STORAGE_ROOT, "renders");
  const updated: Array<{ id: number; status: string }> = [];

  for (const r of pending) {
    const model = r.status_url as string;
    const requestId = r.request_id as string;
    const attempts = (r.attempts ?? 0) + 1;
    try {
      const status = await videoStatus(model, requestId);
      if (status !== "completed") {
        if (attempts >= MAX_ATTEMPTS) {
          fail(r.id, "Timed out waiting for the video render.");
          updated.push({ id: r.id, status: "failed" });
        } else {
          db.prepare("UPDATE renders SET status = ?, attempts = ?, updated_at = datetime('now') WHERE id = ?").run(status, attempts, r.id);
          updated.push({ id: r.id, status });
        }
        continue;
      }

      // completed — get the master url (a terminal fal failure throws / returns null)
      let masterUrl: string | null = null;
      try {
        masterUrl = await videoResultUrl(model, requestId);
      } catch (e) {
        masterUrl = null;
        if (!isTransient(e)) {
          fail(r.id, errMsg(e));
          updated.push({ id: r.id, status: "failed" });
          continue;
        }
      }
      if (!masterUrl) {
        if (attempts >= MAX_ATTEMPTS) {
          fail(r.id, "Render completed but no video was returned.");
          updated.push({ id: r.id, status: "failed" });
        } else {
          db.prepare("UPDATE renders SET attempts = ?, updated_at = datetime('now') WHERE id = ?").run(attempts, r.id);
        }
        continue;
      }

      await fanOutVideo(r, masterUrl, rendersDir);
      // mark the master row terminal so it's not re-polled
      db.prepare("UPDATE renders SET status = 'completed', attempts = ?, updated_at = datetime('now') WHERE id = ?").run(attempts, r.id);
      updated.push({ id: r.id, status: "completed" });
    } catch (e) {
      if (attempts >= MAX_ATTEMPTS || !isTransient(e)) {
        fail(r.id, errMsg(e));
        updated.push({ id: r.id, status: "failed" });
      } else {
        db.prepare("UPDATE renders SET attempts = ?, updated_at = datetime('now') WHERE id = ?").run(attempts, r.id);
      }
    }
  }

  // ── job status rollup ──
  if (Number.isFinite(jobId)) rollupJob(jobId);

  return NextResponse.json({ polled: pending.length, updated });
}

async function fanOutVideo(master: Render, masterUrl: string, rendersDir: string) {
  const job = getJob(master.job_id);
  if (!job) return;
  const brand = getBrandKit();
  const logoOpts = {
    logoPath: brand?.logo_path ?? null,
    logoEnabled: job.logo_enabled === 1,
    logoPosition: (job.logo_position as LogoPosition) || "bottom-right",
  };
  const platforms = jobPlatformKeys(job).map(platformOf);

  await mkdir(rendersDir, { recursive: true });
  const masterName = `master-${job.id}-${randomUUID().slice(0, 6)}.mp4`;
  const masterPath = join(rendersDir, masterName);
  await writeFile(masterPath, Buffer.from(await (await fetch(masterUrl)).arrayBuffer()));

  for (const platform of platforms) {
    try {
      const out = `${job.id}-0-${platform.key}-${randomUUID().slice(0, 6)}.mp4`;
      await finishVideo(masterPath, join(rendersDir, out), { platform, ...logoOpts });
      db.prepare(
        `INSERT INTO renders (job_id, brief_id, shot_index, source_asset_id, platform, status, result_url, attempts, meta)
         VALUES (?, ?, 0, ?, ?, 'completed', ?, 0, ?)`,
      ).run(job.id, master.brief_id, master.source_asset_id, platform.key, assetWebPath(`storage/renders/${out}`), JSON.stringify({ master_url: masterUrl }));
    } catch (e) {
      db.prepare(
        `INSERT INTO renders (job_id, brief_id, shot_index, platform, status, error, attempts, meta)
         VALUES (?, ?, 0, ?, 'failed', ?, 0, '{}')`,
      ).run(job.id, master.brief_id, platform.key, errMsg(e));
    }
  }
}

function fail(id: number, error: string) {
  db.prepare("UPDATE renders SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?").run(error.slice(0, 800), id);
}

function rollupJob(jobId: number) {
  const c = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('queued','processing') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
         COUNT(*) AS total
       FROM renders WHERE job_id = ?`,
    )
    .get(jobId) as { pending: number; done: number; failed: number; total: number };
  if (!c.total) return;
  const status = c.pending > 0 ? "submitted" : c.done > 0 ? "done" : "failed";
  db.prepare("UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, jobId);
}

function isTransient(e: unknown): boolean {
  const m = errMsg(e).toLowerCase();
  return m.includes("fetch") || m.includes("network") || m.includes("timeout") || m.includes("econn") || m.includes("502") || m.includes("503") || m.includes("504");
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
