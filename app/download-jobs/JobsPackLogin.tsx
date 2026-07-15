"use client";

import { useState } from "react";

// Password screen for the external Creative Jobs Pack. A correct POST to
// /api/jobs-pack sets the path-scoped access cookie and we reload into the pack.
export default function JobsPackLogin() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        window.location.reload();
        return;
      }
      setError(data.error ?? "Access failed.");
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "12vh auto 0" }}>
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <svg width="26" height="26" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="0" y="0" width="22" height="22" rx="6" fill="#244260" />
            <path d="M5.5 9 Q11 16 16.5 9" fill="none" stroke="#cfe2d0" strokeWidth="2" strokeLinecap="round" />
            <circle cx="11" cy="5.6" r="1.3" fill="#5793a3" />
          </svg>
          <h1 style={{ margin: 0, fontSize: 21 }}>Dental Nation · Creative Jobs Pack</h1>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Everything a designer, artist, marketer or creative director needs to work with the brand —
          logo, palette, fonts, founder briefs and the brand book. Enter the access password to continue.
        </p>
        <form onSubmit={submit}>
          <label className="small" htmlFor="pack-password">
            Access password
          </label>
          <input
            id="pack-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          {error && (
            <div className="notice danger small" style={{ marginBottom: 12 }}>
              {error}
            </div>
          )}
          <button type="submit" className="btn" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
            {busy ? <span className="spinner" /> : "Unlock the pack"}
          </button>
        </form>
      </div>
      <p className="small muted" style={{ textAlign: "center" }}>
        Shared privately for hiring · please don&apos;t forward the password.
      </p>
    </main>
  );
}
