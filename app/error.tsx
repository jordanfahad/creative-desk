"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <div className="card" style={{ maxWidth: 540, margin: "56px auto", textAlign: "center" }}>
        <h1 style={{ marginBottom: 8 }}>Something went wrong</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          A hiccup on our side — nothing was lost. Try again, or head back to your jobs.
        </p>
        <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
          <button className="btn" onClick={() => reset()}>
            Try again
          </button>
          <a className="btn secondary" href="/">
            Back to Jobs
          </a>
        </div>
      </div>
    </main>
  );
}
