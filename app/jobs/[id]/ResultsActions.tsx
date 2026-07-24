"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ↻ Regenerate = replace the current results, the right way: clear the old
// deliverables, ALWAYS re-run ✨ Optimize (so the new prompt reflects the
// current direction, goal, style and brand context), then render fresh.
export default function ResultsActions({ jobId, media }: { jobId: number; media: "image" | "video" }) {
  const router = useRouter();
  const [stage, setStage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function post(path: string, expectOk = true): Promise<Record<string, unknown>> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (expectOk && !res.ok) throw new Error((data.error as string) ?? `HTTP ${res.status}`);
    return data;
  }

  async function regenerate() {
    if (
      !confirm(
        "Replace the current results? We'll re-optimize the prompt first (your direction, goal, style and brand context), then clear and regenerate. Uses AI credits.",
      )
    ) {
      return;
    }
    setErr(null);
    try {
      // ✨ Optimize FIRST — if it fails, the existing results are untouched.
      // (No mid-flow refresh: a refresh after clearing would unmount this
      // component and swallow the progress + any error.)
      setStage("✨ Re-optimizing the prompt…");
      await post("/api/generate-brief");
      setStage("Clearing old results…");
      await post("/api/render/clear");
      setStage(media === "video" ? "Rendering the video…" : "Generating…");
      await post("/api/render/submit");
      setStage(null);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStage(null);
      setErr(msg);
      // alert survives even if a refresh unmounts this component mid-flow.
      alert(`Regenerate failed: ${msg}`);
      router.refresh();
    }
  }

  return (
    <span className="row" style={{ gap: 10, display: "inline-flex", verticalAlign: "middle" }}>
      <button className="btn secondary sm" disabled={stage !== null} onClick={regenerate}>
        {stage ? (
          <>
            <span className="spinner" /> {stage}
          </>
        ) : (
          "↻ Regenerate (re-optimizes first)"
        )}
      </button>
      {err && <span className="small" style={{ color: "var(--danger)" }}>{err}</span>}
    </span>
  );
}
