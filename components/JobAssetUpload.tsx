"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { attachJobAssets } from "@/lib/actions";

/**
 * Direct-to-storage job-asset uploader. The browser requests a signed URL and
 * PUTs each file straight to Supabase Storage (so large photos/clips don't hit
 * the ~4.5MB Server Action body cap), then records them via attachJobAssets.
 * Errors surface inline — never the app-wide error boundary.
 */
export function JobAssetUpload({
  jobId,
  accept,
  buttonLabel,
}: {
  jobId: number;
  accept: string;
  buttonLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onFiles(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true);
    setError(null);
    const done: { path: string; filename: string }[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setStatus(`Uploading ${i + 1} of ${files.length}…`);
        const res = await fetch("/api/asset-upload-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId, filename: f.name, size: f.size }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? `Couldn't start upload (${res.status}).`);
        const put = await fetch(j.signedUrl, {
          method: "PUT",
          headers: { "content-type": f.type || "application/octet-stream", "x-upsert": "true" },
          body: f,
        });
        if (!put.ok) throw new Error(`Upload failed for ${f.name} (${put.status}).`);
        done.push({ path: j.path, filename: f.name });
      }
      setStatus("Saving…");
      const r = await attachJobAssets(jobId, done);
      if (r.added === 0) throw new Error("Nothing was added — check the file types.");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
      />
      <button className="btn" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? status ?? "Uploading…" : buttonLabel}
      </button>
      {error ? (
        <p className="notice danger small" style={{ marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
