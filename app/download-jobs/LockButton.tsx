"use client";

import { useState } from "react";

// Clears the pack access cookie and returns to the password screen.
export default function LockButton() {
  const [busy, setBusy] = useState(false);
  async function lock() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/jobs-pack", { method: "DELETE" });
    } catch {
      /* ignore — reload still drops back to the gate */
    }
    window.location.reload();
  }
  return (
    <button type="button" onClick={lock} disabled={busy} className="btn secondary sm" title="Lock this pack">
      {busy ? <span className="spinner" /> : "Lock"}
    </button>
  );
}
