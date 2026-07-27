"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveScript } from "@/lib/actions";

export interface ScriptBeat {
  index: number;
  caption: string;
  voiceover: string;
  seconds: number;
  /** short note on what this beat shows, so the writer has context */
  scene: string;
}

// Natural narration is ~2.7 words/second; a caption should be readable at a glance.
const WORDS_PER_SEC = 2.7;
const CAPTION_MAX_WORDS = 7;

function words(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

/**
 * Edit the reel's script beat by beat — the words ON screen and the words SPOKEN
 * — with live length budgets so a line can't quietly overrun its clip. Replaces
 * hand-editing raw brief JSON.
 */
export function ScriptEditor({
  jobId,
  briefId,
  beats,
  postCaption,
  speaking,
}: {
  jobId: number;
  briefId: number;
  beats: ScriptBeat[];
  postCaption: string;
  speaking: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(beats);
  const [post, setPost] = useState(postCaption);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(i: number, field: "caption" | "voiceover", value: string) {
    setRows((r) => r.map((b, n) => (n === i ? { ...b, [field]: value } : b)));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("job_id", String(jobId));
      fd.set("brief_id", String(briefId));
      rows.forEach((b, i) => {
        fd.set(`caption_${i}`, b.caption);
        fd.set(`voiceover_${i}`, b.voiceover);
      });
      fd.set("post_caption", post);
      await saveScript(fd);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const totalVo = rows.reduce((n, b) => n + words(b.voiceover), 0);
  const totalSecs = rows.reduce((n, b) => n + (b.seconds || 5), 0);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Script</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Edit exactly what appears <strong>on screen</strong> and what is{" "}
        <strong>{speaking ? "spoken by your doctor / narrator" : "spoken by the narrator"}</strong>. Keep
        captions short enough to read at a glance; the spoken line should fit its clip
        (~{WORDS_PER_SEC} words per second). Re-run <em>✨ Optimize</em> to have the AI rewrite it all.
      </p>

      {rows.map((b, i) => {
        const vw = words(b.voiceover);
        const budget = Math.round((b.seconds || 5) * WORDS_PER_SEC);
        const over = vw > budget;
        const capW = words(b.caption);
        const capOver = capW > CAPTION_MAX_WORDS;
        return (
          <div
            key={b.index}
            style={{ borderTop: i === 0 ? "none" : "1px solid var(--line, #e5e7eb)", paddingTop: i === 0 ? 0 : 14, marginTop: i === 0 ? 8 : 14 }}
          >
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <strong className="small">Beat {i + 1}</strong>
              <span className="small muted">{b.seconds || 5}s · {b.scene}</span>
            </div>

            <label className="small muted" style={{ display: "block", marginTop: 8 }}>
              On screen{" "}
              <span style={{ color: capOver ? "#b45309" : undefined }}>
                ({capW}/{CAPTION_MAX_WORDS} words{capOver ? " — trim it" : ""})
              </span>
            </label>
            <input value={b.caption} onChange={(e) => patch(i, "caption", e.target.value)} placeholder="e.g. Hiding your smile in photos?" />

            <label className="small muted" style={{ display: "block", marginTop: 8 }}>
              Spoken{" "}
              <span style={{ color: over ? "#b45309" : undefined }}>
                ({vw}/{budget} words{over ? " — will overrun the clip" : ""})
              </span>
            </label>
            <textarea
              value={b.voiceover}
              onChange={(e) => patch(i, "voiceover", e.target.value)}
              placeholder="What the voice says on this beat"
              style={{ minHeight: 56 }}
            />
          </div>
        );
      })}

      <div style={{ borderTop: "1px solid var(--line, #e5e7eb)", paddingTop: 14, marginTop: 14 }}>
        <label className="small muted" style={{ display: "block" }}>Post caption (the text you paste when publishing)</label>
        <textarea value={post} onChange={(e) => { setPost(e.target.value); setSaved(false); }} style={{ minHeight: 70 }} />
      </div>

      <div className="row" style={{ marginTop: 12, gap: 10, alignItems: "center" }}>
        <button className="btn" type="button" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save script"}
        </button>
        <span className="small muted">
          {rows.length} beats · ~{totalSecs}s · {totalVo} spoken words
        </span>
        {saved ? <span className="small" style={{ color: "#166534" }}>✓ saved</span> : null}
      </div>
      {error ? <p className="notice danger small" style={{ marginTop: 8 }}>{error}</p> : null}
    </div>
  );
}
