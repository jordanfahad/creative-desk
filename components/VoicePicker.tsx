"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setJobVoiceover } from "@/lib/actions";

/**
 * Reel voiceover picker. Turns the AI narration on/off and picks the OpenAI TTS
 * voice. The lines themselves come from the brief (one per shot); this only
 * controls whether they're spoken and by which voice. Baked into the reel at
 * assembly time and ducked under the music bed.
 */
const VOICES = [
  { key: "alloy", label: "Alloy — warm, neutral" },
  { key: "nova", label: "Nova — bright, friendly" },
  { key: "shimmer", label: "Shimmer — soft, calm" },
  { key: "onyx", label: "Onyx — deep, confident" },
  { key: "fable", label: "Fable — expressive" },
  { key: "sage", label: "Sage — steady, clear" },
];

export function VoicePicker({ jobId, enabled, voice }: { jobId: number; enabled: boolean; voice: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = voice || "alloy";

  async function save(nextEnabled: boolean, nextVoice: string) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("job_id", String(jobId));
      fd.set("voiceover_enabled", nextEnabled ? "1" : "0");
      fd.set("vo_voice", nextVoice);
      await setJobVoiceover(fd);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid var(--line, #e5e7eb)", paddingTop: 14 }}>
      <p className="small muted" style={{ marginTop: 0 }}>
        <strong>Voiceover.</strong> An AI narrator speaks the brief’s per-shot lines over the reel
        (ducked under the music). Turn it off for a silent-cinematic look with captions + music only.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label className="pill-check" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => save(e.target.checked, current)}
          />{" "}
          AI voiceover
        </label>
        <span className="small muted">voice</span>
        <select
          value={current}
          disabled={busy || !enabled}
          style={{ width: "auto" }}
          onChange={(e) => save(true, e.target.value)}
        >
          {VOICES.map((v) => (
            <option key={v.key} value={v.key}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p className="notice danger small" style={{ marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
