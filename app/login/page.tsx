"use client";

import { useState } from "react";

// Sign-in screen. The middleware sends every unauthenticated request here;
// a successful POST /api/auth sets the session cookie and we head home.
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        window.location.replace("/");
        return;
      }
      setError(data.error ?? "Sign-in failed.");
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: "9vh auto 0" }}>
      <div className="card">
        <h1 style={{ marginTop: 0, fontSize: 22 }}>Sign in</h1>
        <p className="small muted" style={{ marginTop: 0 }}>
          Creative Desk is private — sign in to continue.
        </p>
        <form onSubmit={submit}>
          <label className="small" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <label className="small" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ marginBottom: 14 }}
          />
          <button className="btn" type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {error && (
          <p className="notice danger small" style={{ marginTop: 12, marginBottom: 0 }}>
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
