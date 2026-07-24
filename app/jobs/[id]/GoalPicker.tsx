"use client";

import { useRef } from "react";

// Auto-saves the funnel goal the moment it changes — no separate "Save" step —
// so the dropdown can never appear to "snap back" to a previous value.
export default function GoalPicker({
  jobId,
  value,
  action,
}: {
  jobId: number;
  value: string;
  action: (fd: FormData) => Promise<void>;
}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form action={action} ref={ref} className="row" style={{ margin: 0, gap: 6 }}>
      <input type="hidden" name="id" value={jobId} />
      <span className="small muted">goal</span>
      <select
        name="funnel_goal"
        defaultValue={value}
        onChange={() => ref.current?.requestSubmit()}
        style={{ width: "auto" }}
      >
        <option value="">General / not set</option>
        <option value="awareness">Brand awareness — be remembered, no hard sell</option>
        <option value="consideration">Consideration — build trust, soft invite</option>
        <option value="conversion">Conversion — drive bookings, clear CTA</option>
      </select>
    </form>
  );
}
