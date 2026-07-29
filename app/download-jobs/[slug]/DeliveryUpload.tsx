"use client";

import { useRef, useState } from "react";

interface Done {
  name: string;
  folder: string;
}

/**
 * Delivery uploader for an external designer. Files go straight to storage via
 * a signed URL (so big video masters don't hit the server body cap), into the
 * folder they pick — the API only ever accepts folders from their own brief.
 */
export default function DeliveryUpload({ slug, folders }: { slug: string; folders: string[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState(folders[0] ?? "_source");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [done, setDone] = useState<Done[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  async function send(files: FileList) {
    setBusy(true);
    setErrors([]);
    const ok: Done[] = [];
    const bad: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setProgress(`Uploading ${i + 1} of ${files.length} — ${f.name}`);
      try {
        const res = await fetch("/api/jobs-pack/upload-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug, filename: f.name, size: f.size, folder }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? `Could not start upload (${res.status})`);
        const put = await fetch(j.signedUrl, {
          method: "PUT",
          headers: { "content-type": j.contentType, "x-upsert": "true" },
          body: f,
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        ok.push({ name: f.name, folder });
      } catch (e) {
        bad.push(`${f.name} — ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    setDone((d) => [...ok, ...d]);
    setErrors(bad);
    setProgress("");
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="card" style={{ borderColor: "var(--accent, #2f6f4f)" }}>
      <h3 style={{ marginTop: 0 }}>Upload your deliverables</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Pick the lane, then choose your files. Large video masters are fine — they upload straight to
        storage. Put project files, fonts and music licences in <strong>_source</strong>.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="small muted">folder</span>
        <select value={folder} disabled={busy} onChange={(e) => setFolder(e.target.value)} style={{ width: "auto" }}>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <input
          ref={inputRef}
          type="file"
          multiple
          disabled={busy}
          onChange={(e) => e.target.files?.length && send(e.target.files)}
        />
      </div>
      {progress ? (
        <p className="small" style={{ marginTop: 10 }}>
          <span className="spinner" /> {progress}
        </p>
      ) : null}
      {done.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="small" style={{ color: "#166534", marginBottom: 6 }}>
            ✓ {done.length} file{done.length === 1 ? "" : "s"} uploaded
          </p>
          <ul className="small muted" style={{ marginTop: 0 }}>
            {done.slice(0, 12).map((d, i) => (
              <li key={i}>
                {d.folder} / {d.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {errors.length > 0 && (
        <div className="notice danger small" style={{ marginTop: 10 }}>
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
