import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <div className="card" style={{ maxWidth: 540, margin: "56px auto", textAlign: "center" }}>
        <h1 style={{ marginBottom: 8 }}>Not found</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          That page or job doesn’t exist — it may have been deleted.
        </p>
        <div style={{ marginTop: 18 }}>
          <Link href="/" className="btn">
            Back to Jobs
          </Link>
        </div>
      </div>
    </main>
  );
}
