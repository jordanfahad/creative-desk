"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { attachCharacters } from "@/lib/actions";

export interface PickerCharacter {
  id: number;
  name: string;
  media: "image" | "video";
  url: string;
}

/**
 * "Add from Team" — pull reusable team members (uploaded once in the brand kit)
 * into this job as source photos/videos. For a reel, the chosen real people are
 * animated (subject preserved) instead of a generated stranger.
 */
export function CharacterPicker({
  jobId,
  characters,
  attachedIds,
}: {
  jobId: number;
  characters: PickerCharacter[];
  attachedIds: number[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attachedSet = new Set(attachedIds);
  const available = characters.filter((c) => !attachedSet.has(c.id));

  function toggle(id: number) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function attach() {
    if (!sel.size || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("job_id", String(jobId));
      for (const id of sel) fd.append("character_id", String(id));
      await attachCharacters(fd);
      setSel(new Set());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--line, #e5e7eb)", paddingTop: 14 }}>
      <p className="small muted" style={{ marginTop: 0 }}>
        <strong>Add from Team.</strong> Feature your real doctors/staff — a reel animates the real
        person (same face, real gown &amp; logo).{" "}
        {characters.length === 0 && (
          <>
            None yet — add them in <a href="/brand">Brand kit → Team &amp; characters</a>.
          </>
        )}
      </p>
      {available.length > 0 && (
        <>
          <div className="grid cols-3" style={{ gap: 10 }}>
            {available.map((c) => {
              const on = sel.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  style={{
                    padding: 0,
                    border: on ? "2px solid var(--accent, #2f6f4f)" : "1px solid var(--border, #e5e7eb)",
                    borderRadius: 8,
                    overflow: "hidden",
                    background: "var(--card, #fff)",
                    cursor: "pointer",
                    position: "relative",
                    textAlign: "left",
                  }}
                >
                  {c.media === "video" ? (
                    <video src={c.url} muted playsInline style={{ width: "100%", height: 120, objectFit: "cover", display: "block", background: "#000" }} />
                  ) : (
                    <img src={c.url} alt={c.name} style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} />
                  )}
                  {on && (
                    <span style={{ position: "absolute", top: 6, right: 6, background: "var(--accent, #2f6f4f)", color: "#fff", borderRadius: 999, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>
                      ✓
                    </span>
                  )}
                  <span className="small" style={{ display: "block", padding: "5px 7px" }}>
                    {c.name}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: 10, alignItems: "center", gap: 8 }}>
            <button className="btn secondary sm" type="button" disabled={busy || !sel.size} onClick={attach}>
              {busy ? "Adding…" : sel.size ? `Add ${sel.size} to this job` : "Select team members"}
            </button>
          </div>
          <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
            After adding, click <strong>✨ Optimize prompt</strong> again so the captions &amp;
            voiceover are written for these people.
          </p>
        </>
      )}
      {characters.length > 0 && available.length === 0 && (
        <p className="small muted" style={{ marginTop: 0 }}>All your team members are already added to this job.</p>
      )}
      {error ? (
        <p className="notice danger small" style={{ marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
