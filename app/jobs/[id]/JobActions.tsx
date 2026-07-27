"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface Props {
  jobId: number;
  status: string;
  intent: "optimize" | "create";
  media: "image" | "video";
  videoMode?: string;
  channels: number;
  hasBrief: boolean;
  assetCount: number;
  imageAssetCount?: number;
}

export default function JobActions({ jobId, status, intent, media, videoMode, channels, hasBrief, assetCount, imageAssetCount }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-poll while a video master is rendering. In-flight guard: fan-out can
  // take >10s, and overlapping poll requests must not stack up.
  useEffect(() => {
    if (status === "submitted") {
      let inFlight = false;
      pollTimer.current = setInterval(async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          await fetch("/api/render/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId }),
          });
          router.refresh();
        } catch {
          /* keep trying */
        } finally {
          inFlight = false;
        }
      }, 10000);
    }
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [status, jobId, router]);

  async function call(label: string, path: string) {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? `HTTP ${res.status}` });
      } else {
        setMsg({ kind: "ok", text: summarize(label, data) });
        router.refresh();
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const rendering = status === "submitted";

  // Readiness — gate the Generate button so a premature click can't 400.
  const isMontage = media === "video" && videoMode === "montage";
  const isStudio = media === "video" && videoMode === "studio";
  const reasons: string[] = [];
  if (channels === 0) reasons.push("tick at least one channel");
  if (isMontage) {
    if ((imageAssetCount ?? 0) === 0) reasons.push("add photos for the montage");
  } else if (isStudio) {
    // Studio Finish works on the clinic's OWN footage — the video is the
    // content, so no AI brief is required, just a clip.
    if (assetCount === 0) reasons.push("upload the video you filmed");
  } else {
    if (intent === "create" && !hasBrief) reasons.push("optimize the prompt first");
    if (intent === "optimize" && assetCount === 0)
      reasons.push(`add a ${media === "video" ? "video" : "photo"} to optimize`);
  }
  const notReady = reasons.length > 0;

  return (
    <div>
      <div className="row">
        <button
          className={hasBrief ? "btn secondary" : "btn"}
          disabled={busy !== null}
          onClick={() => call("brief", "/api/generate-brief")}
        >
          {busy === "brief"
            ? "✨ Optimizing…"
            : hasBrief
              ? "↻ Re-optimize prompt"
              : "✨ Optimize prompt with AI"}
        </button>
        <button
          className={hasBrief ? "btn" : "btn secondary"}
          disabled={busy !== null || rendering || notReady}
          title={notReady ? `First: ${reasons.join(", ")}` : undefined}
          onClick={() => call("submit", "/api/render/submit")}
        >
          {busy === "submit" ? (
            <>
              <span className="spinner" /> Generating…
            </>
          ) : (
            `★ Generate · ${channels} channel${channels === 1 ? "" : "s"}`
          )}
        </button>
        {rendering && (
          <span className="small muted">
            <span className="spinner" /> rendering…
          </span>
        )}
      </div>

      {notReady ? (
        <p className="small muted" style={{ marginTop: 10 }}>
          To generate, first {reasons.join(", and ")}.
        </p>
      ) : (
        <p className="small muted" style={{ marginTop: 10 }}>
          {isMontage
            ? hasBrief
              ? "Assembles the AI-curated montage and delivers it to every selected channel. No AI render credits."
              : "Tip: click ✨ Optimize prompt first — the AI picks the strongest photos, their order and pacing for your goal. (Without it, all photos play in upload order.) No AI render credits."
            : hasBrief
              ? "Renders the AI-optimized prompt to every selected channel. Uses fal credits."
              : `Tip: click ✨ Optimize prompt first — it turns your direction into a brand-aligned, production-grade prompt for much better ${media}s. Uses fal credits.`}
        </p>
      )}

      {msg && (
        <p className={`notice ${msg.kind === "err" ? "danger" : ""}`} style={{ marginTop: 12 }}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

function summarize(label: string, data: Record<string, unknown>): string {
  if (label === "brief") return "Prompt optimized — review it below, then Generate.";
  if (label === "submit") {
    const subs = (data.submitted as Array<{ status: string; error?: string }>) ?? [];
    if (data.status === "submitted") return "Video queued — rendering now (auto-checking every 10s).";
    const ok = subs.filter((s) => s.status === "completed").length;
    const failed = subs.filter((s) => s.status === "failed");
    const errs = [...new Set(failed.map((s) => s.error).filter(Boolean))];
    return failed.length
      ? `${ok} ready, ${failed.length} failed. ${errs.join("; ")}`
      : `${ok} deliverable${ok === 1 ? "" : "s"} ready — see Results.`;
  }
  return "Done.";
}
