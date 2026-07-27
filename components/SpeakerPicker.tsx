"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setJobSpeaker } from "@/lib/actions";

export interface SpeakerOption {
  id: number;
  name: string;
  url: string;
}

/**
 * Pick which consented team member delivers the reel's opening line on camera.
 * Only people marked "can speak" in Brand kit → Team appear here, and consent is
 * re-checked again at render time.
 */
export function SpeakerPicker({
  jobId,
  speakers,
  current,
}: {
  jobId: number;
  speakers: SpeakerOption[];
  current: number | null;
}) {
  const router = useRouter();
  const [val, setVal] = useState<string>(current ? String(current) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string) {
    if (next === val) return;
    setVal(next);
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("job_id", String(jobId));
      fd.set("speaker_asset_id", next);
      await setJobSpeaker(fd);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setVal(current ? String(current) : "");
    } finally {
      setBusy(false);
    }
  }

  const chosen = speakers.find((s) => String(s.id) === val);

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid var(--line, #e5e7eb)", paddingTop: 14 }}>
      <p className="small muted" style={{ marginTop: 0 }}>
        <strong>Doctor speaks the opening line.</strong> Their real photo is animated to deliver the
        first line of the script on camera, then the reel cuts to your clinic footage.{" "}
        {speakers.length === 0 && (
          <>
            No one is cleared yet — in <a href="/brand">Brand kit → Team</a>, tick{" "}
            <em>“Mark consented to speak”</em> for anyone who has given you written sign-off.
          </>
        )}
      </p>
      {speakers.length > 0 && (
        <>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="small muted">speaker</span>
            <select value={val} disabled={busy} style={{ width: "auto" }} onChange={(e) => save(e.target.value)}>
              <option value="">No one — narrator voiceover only</option>
              {speakers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {busy ? <span className="small muted">saving…</span> : null}
            {chosen ? (
              <img
                src={chosen.url}
                alt={chosen.name}
                style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 999, border: "1px solid var(--border)" }}
              />
            ) : null}
          </div>
          {chosen ? (
            <p className="small muted" style={{ marginTop: 6, marginBottom: 0 }}>
              Have {chosen.name} approve the exact opening line before you publish — they are
              professionally accountable for anything they appear to say. Adds ~2 minutes and uses
              credits.
            </p>
          ) : null}
        </>
      )}
      {error ? (
        <p className="notice danger small" style={{ marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
