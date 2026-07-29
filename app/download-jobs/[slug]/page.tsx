import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { JOBS_PACK_COOKIE, verifyPackToken } from "@/lib/jobsPack";
import { designerBrief, briefTotals } from "@/lib/designerBriefs";
import JobsPackLogin from "../JobsPackLogin";
import DeliveryUpload from "./DeliveryUpload";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { video: "Video", static: "Static", gbp: "GBP post" };

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const b = designerBrief(slug);
  return { title: b ? `${b.name} · Creative sprint brief` : "Creative sprint brief" };
}

export default async function DesignerBriefPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brief = designerBrief(slug);
  if (!brief) notFound();

  // Same password gate as the main pack — external hires never see the app.
  const token = (await cookies()).get(JOBS_PACK_COOKIE)?.value;
  if (!(await verifyPackToken(token))) return <JobsPackLogin />;

  const t = briefTotals(brief);
  const folders = [...brief.lanes.map((l) => `Lane-${l.key}`), "_source"];

  return (
    <main className="wrap">
      <p className="small muted" style={{ marginBottom: 4 }}>
        <Link href="/download-jobs">← Brand kit, briefs &amp; guidelines</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>{brief.name} — creative sprint</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {brief.dates} · {brief.channels} · <strong>{brief.bias}</strong>
      </p>

      {/* headline numbers */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ gap: 28, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{t.total}</div>
            <div className="small muted">deliverables</div>
          </div>
          <div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{t.video}</div>
            <div className="small muted">video</div>
          </div>
          <div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{t.static}</div>
            <div className="small muted">static</div>
          </div>
          <div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{t.gbp}</div>
            <div className="small muted">GBP · {brief.clinics.length} clinics</div>
          </div>
          <div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>
              {t.masters}
              <span style={{ fontSize: 16, fontWeight: 400 }}> + {t.variants}</span>
            </div>
            <div className="small muted">masters + variants</div>
          </div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <div className="card">
          <strong className="small">Clinics — every lane ships one GBP post per clinic</strong>
          <ul className="small muted" style={{ marginTop: 6, marginBottom: 0 }}>
            {brief.clinics.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <div className="card">
          <strong className="small">Kit — it lives on two sites</strong>
          <ul className="small" style={{ marginTop: 6, marginBottom: 0 }}>
            {brief.equipment.map((e) => (
              <li key={e.item} style={{ marginBottom: 4 }}>
                <strong>{e.item}</strong> — {e.location}
                <br />
                <span className="muted">{e.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {brief.intro.map((p, i) => (
        <p key={i} style={{ marginTop: 14 }}>
          {p}
        </p>
      ))}

      <h2>The work — by lane</h2>
      {brief.lanes.map((l, i) => (
        <div className="card" key={l.key} style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>
              {i + 1}. Lane {l.key} — {l.name}
            </h3>
            <span className="badge">{l.priority}</span>
          </div>
          <p className="small" style={{ marginTop: 6, marginBottom: 4 }}>
            <strong>{l.offer}</strong>
          </p>
          <p className="small muted" style={{ marginTop: 0 }}>
            {l.direction}{" "}
            <a href={l.landing} target="_blank" rel="noreferrer">
              {l.landing.replace("https://www.dentalnation.com", "")}
            </a>
          </p>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Ref</th>
                <th>Type</th>
                <th>#</th>
                <th>Concept</th>
              </tr>
            </thead>
            <tbody>
              {l.concepts.map((c) => (
                <tr key={c.ref}>
                  <td className="small muted">{c.ref}</td>
                  <td className="small">
                    {KIND_LABEL[c.kind]}
                    <br />
                    <span className={`badge ${c.tier === "master" ? "done" : ""}`} style={{ fontSize: 11 }}>
                      {c.tier}
                    </span>
                  </td>
                  <td className="small">{c.count}</td>
                  <td className="small">
                    <strong>{c.title}</strong>
                    {c.note ? <span className="muted"> — {c.note}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 6, marginBottom: 0 }}>
            Lane total:{" "}
            {l.concepts.reduce((n, c) => n + c.count, 0)} deliverables (
            {l.concepts.filter((c) => c.kind === "video").reduce((n, c) => n + c.count, 0)} video ·{" "}
            {l.concepts.filter((c) => c.kind === "static").reduce((n, c) => n + c.count, 0)} static ·{" "}
            {l.concepts.filter((c) => c.kind === "gbp").reduce((n, c) => n + c.count, 0)} GBP)
          </p>
        </div>
      ))}

      <h2>Output specs</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Crops are exports of a concept, not extra assets.
      </p>
      <div className="card">
        <ul className="small" style={{ marginTop: 0 }}>
          {brief.specs.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
        <strong className="small">Non-negotiable</strong>
        <ul className="small" style={{ marginBottom: 0 }}>
          {brief.rules.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </div>

      <h2>Schedule</h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Focus</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {brief.schedule.map((d) => (
              <tr key={d.day}>
                <td className="small">
                  <strong>{d.day}</strong>
                </td>
                <td className="small">{d.focus}</td>
                <td className="small">{d.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Deliver your work</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Name files <code>DN_&lt;lane&gt;_&lt;offer&gt;_&lt;concept&gt;_&lt;ratio&gt;_v&lt;n&gt;</code> — e.g.{" "}
        <code>DN_LaneE_GlowUp_BeforeAfter_9x16_v1.mp4</code>
      </p>
      <DeliveryUpload slug={brief.slug} folders={folders} />

      <h2>Definition of done</h2>
      <div className="card">
        <ol className="small" style={{ marginTop: 0, marginBottom: 0 }}>
          {brief.done.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ol>
      </div>

      <h2>Reference</h2>
      <div className="card">
        <ul className="small" style={{ marginTop: 0, marginBottom: 0 }}>
          {brief.reference.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
