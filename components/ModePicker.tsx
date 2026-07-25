"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setJobVideoMode } from "@/lib/actions";

/**
 * Video-mode selector that auto-saves on change (controlled state, so it can't
 * be reset by a page re-render the way an uncontrolled <select defaultValue>
 * inside a form could). Picking a mode persists it immediately and refreshes so
 * that mode's controls (e.g. the reel's shot count + voiceover) appear — no
 * separate "Save" step just to switch modes.
 */
function options(isOptimize: boolean): { v: string; l: string }[] {
  return [
    ...(isOptimize ? [{ v: "passthrough", l: "size + brand only (no AI)" }] : []),
    { v: "animate", l: "animate / generate (AI)" },
    ...(!isOptimize ? [{ v: "reel", l: "cinematic reel — AI clips + captions + voiceover" }] : []),
    { v: "montage", l: "photo montage — images → video (no AI credits)" },
  ];
}

export function ModePicker({
  jobId,
  current,
  isOptimize,
}: {
  jobId: number;
  current: string;
  isOptimize: boolean;
}) {
  const router = useRouter();
  const [val, setVal] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    if (next === val) return;
    setVal(next);
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("job_id", String(jobId));
      fd.set("video_mode", next);
      await setJobVideoMode(fd);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not switch mode.");
      setVal(current); // roll back the visible selection on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ gap: 6, alignItems: "center" }}>
      <span className="small muted">video</span>
      <select value={val} disabled={busy} onChange={(e) => change(e.target.value)} style={{ width: "auto" }}>
        {options(isOptimize).map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
      {busy ? <span className="small muted">saving…</span> : null}
      {error ? <span className="small notice danger">{error}</span> : null}
    </div>
  );
}
