"use client";

// Replaces the root layout when an error escapes it, so it must bring its own
// <html>/<body> and inline styles (globals.css is not guaranteed to load).
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f4f1e9", color: "#20303f", fontFamily: "Helvetica, system-ui, sans-serif" }}>
        <div style={{ maxWidth: 520, margin: "84px auto", textAlign: "center", padding: 24 }}>
          <h1 style={{ color: "#244260", margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ color: "#6c7785", marginTop: 0 }}>Please refresh the page to continue.</p>
          <button
            onClick={() => reset()}
            style={{ marginTop: 16, background: "#244260", color: "#fff", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
