"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface Props {
  jobId: number;
  status: string;
  intent: "optimize" | "create";
  media: "image" | "video";
  channels: number;
  hasBrief: boolean;
  assetCount: number;
}

export default function JobActions({ jobId, status, intent, media, channels, hasBrief, assetCount }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-poll while a video master is rendering.
  useEffect(() => {
    if (status === "submitted") {
      pollTimer.current = setInterval(async () => {
        try {
          await fetch("/api/render/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId }),
          });
          router.refresh();
        } catch {
          /* keep trying */
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

  const needsBrief = intent === "create";
  const rendering = status === "submitted";

  // Readiness — gate the Generate button so a premature click can't 400.
  const reasons: string[] = [];
  if (channels === 0) reasons.push("tick at least one channel");
  if (intent === "create" && !hasBrief) reasons.push("generate the brief first");
  if (intent === "optimize" && assetCount === 0)
    reasons.push(`add a ${media === "video" ? "video" : "photo"} to optimize`);
  const notReady = reasons.length > 0;

  return (
    <div>
      <div className="row">
        {needsBrief && (
          <button
            className="btn secondary"
            disabled={busy !== null}
            onClick={() => call("brief", "/api/generate-brief")}
          >
            {busy === "brief" ? "Planning…" : hasBrief ? "Regenerate brief" : "Generate brief"}
          </button>
        )}
        <button
          className="btn"
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
          {needsBrief
            ? "Renders the brief to every selected channel."
            : `Generates one ${media} per source and crops + brands it for all ${channels} channel${channels === 1 ? "" : "s"}.`}{" "}
          Uses fal credits.
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
  if (label === "brief") return "Brief ready. Review it below, then Generate.";
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
