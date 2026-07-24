"use client";

import { useState } from "react";

// Auto-saves the funnel goal the moment it changes — no separate "Save" step —
// and shows a "✓ saved" confirmation so the auto-save is never invisible.
export default function GoalPicker({
  jobId,
  value,
  action,
}: {
  jobId: number;
  value: string;
  action: (fd: FormData) => Promise<void>;
}) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const fd = new FormData();
    fd.set("id", String(jobId));
    fd.set("funnel_goal", e.target.value);
    setStatus("saving");
    try {
      await action(fd);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1800);
    } catch {
      setStatus("idle");
    }
  }

  return (
    <div className="row" style={{ gap: 6, margin: 0 }}>
      <span className="small muted">goal</span>
      <select name="funnel_goal" defaultValue={value} onChange={onChange} style={{ width: "auto" }}>
        <option value="">General / not set</option>
        <option value="awareness">Brand awareness — be remembered, no hard sell</option>
        <option value="consideration">Consideration — build trust, soft invite</option>
        <option value="conversion">Conversion — drive bookings, clear CTA</option>
      </select>
      {status === "saving" && <span className="small muted">saving…</span>}
      {status === "saved" && (
        <span className="small" style={{ color: "var(--ok)", fontWeight: 600 }}>
          ✓ saved
        </span>
      )}
    </div>
  );
}
