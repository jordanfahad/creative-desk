"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setJobReelStyle, setJobMotionMode } from "@/lib/actions";

export interface StyleOption {
  key: string;
  label: string;
  blurb: string;
}

/**
 * Reel house style + how real photos move. Both auto-save (controlled state, so
 * a background page refresh can't reset the selection mid-choice).
 */
export function ReelStylePicker({
  jobId,
  styles,
  current,
  motionMode,
  hasPhotos,
}: {
  jobId: number;
  styles: StyleOption[];
  current: string;
  motionMode: string;
  hasPhotos: boolean;
}) {
  const router = useRouter();
  const [val, setVal] = useState(current || "auto");
  const [motion, setMotion] = useState(motionMode || "preserve");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = styles.find((s) => s.key === val) ?? styles[0];

  async function save(next: string) {
    if (next === val) return;
    setVal(next);
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("job_id", String(jobId));
      fd.set("reel_style", next);
      await setJobReelStyle(fd);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setVal(current);
    } finally {
      setBusy(false);
    }
  }

  async function saveMotion(next: string) {
    if (next === motion) return;
    setMotion(next);
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("job_id", String(jobId));
      fd.set("motion_mode", next);
      await setJobMotionMode(fd);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setMotion(motionMode);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid var(--line, #e5e7eb)", paddingTop: 14 }}>
      <p className="small muted" style={{ marginTop: 0 }}>
        <strong>Reel style.</strong> Sets the whole look — colour grade, caption type, cut pacing and
        default music.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="small muted">style</span>
        <select value={val} disabled={busy} style={{ width: "auto" }} onChange={(e) => save(e.target.value)}>
          {styles.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {busy ? <span className="small muted">saving…</span> : null}
      </div>
      {active ? (
        <p className="small muted" style={{ marginTop: 6, marginBottom: 0 }}>
          {active.blurb}
        </p>
      ) : null}

      {hasPhotos && (
        <div style={{ marginTop: 14 }}>
          <p className="small muted" style={{ marginTop: 0, marginBottom: 6 }}>
            <strong>How your real photos move.</strong>
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={motion}
              disabled={busy}
              style={{ width: "auto" }}
              onChange={(e) => saveMotion(e.target.value)}
            >
              <option value="preserve">Preserve (recommended) — real camera move, logo stays sharp · free</option>
              <option value="ai">AI motion — lifelike movement, but blurs small logos/text · uses credits</option>
            </select>
          </div>
          <p className="small muted" style={{ marginTop: 6, marginBottom: 0 }}>
            {motion === "preserve"
              ? "Moves the camera across your actual photo — faces, gowns and the real embroidered logo stay pixel-perfect. Costs nothing and renders in seconds."
              : "An AI video model adds lifelike motion (subtle movement), but it repaints every frame, so fine embroidery and small text can come out garbled."}
          </p>
        </div>
      )}
      {error ? (
        <p className="notice danger small" style={{ marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
