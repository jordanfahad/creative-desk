"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setJobMusic } from "@/lib/actions";

/**
 * Video soundtrack picker — applies to EVERY video type (baked into montage
 * masters, muxed into AI clips, optional on enhanced uploads). Paid ads can't
 * use the platform's in-app music, so audio has to be in the file. Options: a
 * built-in bed (calm / warm / uplift / upbeat), synthesized in the renderer
 * (royalty-free by construction); or the user's own licensed track, uploaded
 * straight to storage. Whatever is chosen is looped/trimmed to length with a
 * fade. For truly premium output, an uploaded licensed track beats the
 * synthesized beds.
 */
const PRESETS = [
  { key: "warm", label: "Warm (calm major pad)" },
  { key: "calm", label: "Calm (soft, still)" },
  { key: "uplift", label: "Uplift (brighter)" },
  { key: "upbeat", label: "Upbeat (energetic — conversion ads)" },
];

export function MusicPicker({ jobId, current }: { jobId: number; current: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCustom = current.startsWith("assets/");
  const selectValue = isCustom ? "__custom" : current || "";

  async function save(track: string) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("job_id", String(jobId));
      fd.set("music_track", track);
      await setJobMusic(fd);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/asset-upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId, filename: file.name, size: file.size }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Couldn't start upload (${res.status}).`);
      const put = await fetch(j.signedUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream", "x-upsert": "true" },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
      const fd = new FormData();
      fd.set("job_id", String(jobId));
      fd.set("music_track", j.path);
      await setJobMusic(fd);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 18, borderTop: "1px solid var(--line, #e5e7eb)", paddingTop: 14 }}>
      <p className="small muted" style={{ marginTop: 0 }}>
        <strong>Soundtrack.</strong> Baked into every video export (montage or AI clip) — needed for
        paid ads, which can’t use the platform’s in-app music. Pick a built-in bed or, for the most
        premium result, <strong>upload your own licensed track</strong>; it’s fit to the video with a
        gentle fade. Leave on “No music” to export silent and add trending audio in-app for organic
        posts.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="small muted">music</span>
        <select
          value={selectValue}
          disabled={busy}
          style={{ width: "auto" }}
          onChange={(e) => {
            if (e.target.value === "__custom") return; // custom is set via upload
            save(e.target.value);
          }}
        >
          <option value="">No music (silent)</option>
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
          {isCustom && <option value="__custom">Custom uploaded track ✓</option>}
        </select>

        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <button className="btn secondary sm" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Working…" : isCustom ? "Replace my track" : "Upload my track"}
        </button>
        {isCustom && !busy && (
          <button className="btn danger sm" type="button" onClick={() => save("")}>
            Remove
          </button>
        )}
      </div>
      {error ? (
        <p className="notice danger small" style={{ marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}