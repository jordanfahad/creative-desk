import Link from "next/link";
import { listJobs, getBrandKit } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  briefed: "Planned",
  approved: "Approved",
  submitted: "Rendering",
  done: "Ready",
  failed: "Failed",
};

export default async function Home() {
  const jobs = await listJobs();
  const brand = await getBrandKit();

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ marginBottom: 4 }}>Creative Desk</h1>
        <span className="small muted">{brand?.clinic_name ?? "set up the brand kit"}</span>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Optimize an existing creative or make a new one — branded and sized for every
        channel (GMB, paid, organic).
      </p>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Link href="/jobs/new" className="card entry" style={{ textDecoration: "none", color: "inherit" }}>
          <h3 style={{ marginTop: 0 }}>↻ Optimize a creative</h3>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Upload a photo or video — fix it on-brand and size it for every channel.
          </p>
        </Link>
        <Link href="/jobs/new" className="card entry" style={{ textDecoration: "none", color: "inherit" }}>
          <h3 style={{ marginTop: 0 }}>✦ Create something new</h3>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Describe it — generate it on-brand for every channel.
          </p>
        </Link>
      </div>

      <h2>Recent jobs</h2>
      {jobs.length === 0 ? (
        <p className="muted small">No jobs yet. Start one above.</p>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <Link href={`/jobs/${j.id}`}>{j.title}</Link>
                  </td>
                  <td className="muted small">
                    {j.intent === "optimize" ? "Optimize" : "Create"} ·{" "}
                    {j.media === "video" ? "Video" : "Image"}
                  </td>
                  <td>
                    <span className={`badge ${j.status}`}>{STATUS_LABEL[j.status] ?? j.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
