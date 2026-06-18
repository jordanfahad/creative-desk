import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getJob,
  getLatestBrief,
  listRenders,
  getAssetsByIds,
  assetWebPath,
  resolveDocUrl,
  jobPlatformKeys,
} from "@/lib/db";
import { BriefSchema, type Brief } from "@/lib/context";
import {
  deleteJob,
  saveBriefEdit,
  uploadBriefDoc,
  removeBriefDoc,
  setProduction,
  setDirection,
  uploadJobAsset,
  removeJobAsset,
} from "@/lib/actions";
import { PLATFORM_GROUPS, PLATFORMS, LOGO_POSITIONS } from "@/lib/platform";
import JobActions from "./JobActions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  briefed: "Planned",
  approved: "Approved",
  submitted: "Rendering",
  done: "Ready",
  failed: "Failed",
};

function parseBrief(content: string): Brief | null {
  const r = BriefSchema.safeParse(JSON.parse(content || "null"));
  return r.success ? r.data : null;
}
function isVideo(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}

export default async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const job = await getJob(jobId);
  if (!job) notFound();

  const briefRow = await getLatestBrief(jobId);
  const brief = briefRow ? parseBrief(briefRow.content) : null;
  const renders = await listRenders(jobId);
  let assetIds: number[] = [];
  try {
    const v = JSON.parse(job.asset_ids || "[]");
    if (Array.isArray(v)) assetIds = v.map(Number).filter(Number.isFinite);
  } catch {
    /* ignore */
  }
  const assets = await getAssetsByIds(assetIds);
  const briefDocUrl = await resolveDocUrl(job.brief_doc_path);
  const selected = new Set(jobPlatformKeys(job));
  const isOptimize = job.intent === "optimize";
  const isVideoJob = job.media === "video";

  // Spend estimate: paid AI generations only — channel re-crops are free.
  const imageAssetCount = assets.filter((a) => a.media !== "video").length;
  let aiCalls = 0;
  if (!isOptimize) aiCalls = brief ? brief.shots.length : 0;
  else if (!isVideoJob) aiCalls = job.combine === 1 ? (imageAssetCount ? 1 : 0) : imageAssetCount;
  else aiCalls = job.video_mode === "passthrough" ? 0 : 1;
  const ch = selected.size;
  const chWord = `${ch} channel${ch === 1 ? "" : "s"}`;

  // deliverables (hide internal video master rows where platform is null)
  const deliverables = renders.filter((r) => r.platform);
  const pendingMasters = renders.filter((r) => !r.platform && (r.status === "queued" || r.status === "processing"));
  const groups = new Map<string, typeof deliverables>();
  for (const r of deliverables) {
    const key = r.source_asset_id != null ? `Source #${r.source_asset_id}` : `Shot ${r.shot_index + 1}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  return (
    <main>
      <p className="small">
        <Link href="/">← Jobs</Link>
      </p>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>{job.title}</h1>
          <div className="row small">
            <span className={`badge ${job.status}`}>{STATUS_LABEL[job.status] ?? job.status}</span>
            <span className="muted">
              {isOptimize ? "Optimize" : "Create"} · {isVideoJob ? "Video" : "Image"}
            </span>
          </div>
        </div>
        <form action={deleteJob}>
          <input type="hidden" name="id" value={job.id} />
          <button className="btn danger sm" type="submit">
            Delete
          </button>
        </form>
      </div>

      {/* ── 1 · SOURCE (optimize only) ── */}
      {isOptimize && (
        <div className="card" style={{ marginTop: 18 }}>
          <h3 style={{ marginTop: 0 }}>1 · Your {isVideoJob ? "video" : "photos"}</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            Upload the {isVideoJob ? "clip(s)" : "image(s)"} to fix & optimize — each is
            edited on-brand, cropped to every channel, and logo-stamped.
          </p>
          {assets.length > 0 && (
            <div className="grid cols-3" style={{ marginBottom: 12 }}>
              {assets.map((a) => (
                <div key={a.id}>
                  {a.media === "video" ? (
                    <video className="thumb" src={assetWebPath(a.local_path)} muted />
                  ) : (
                    <img className="thumb" src={assetWebPath(a.local_path)} alt={a.filename} />
                  )}
                  <form action={removeJobAsset} style={{ marginTop: 4 }}>
                    <input type="hidden" name="job_id" value={job.id} />
                    <input type="hidden" name="asset_id" value={a.id} />
                    <button className="btn danger sm" type="submit">
                      Remove
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
          <form action={uploadJobAsset}>
            <input type="hidden" name="job_id" value={job.id} />
            <input type="file" name="file" accept={isVideoJob ? "video/*" : "image/*"} multiple required />
            <div style={{ marginTop: 10 }}>
              <button className="btn" type="submit">
                + Add {isVideoJob ? "video" : "photos"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── 2 · DIRECTION ── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>
          {isOptimize ? "2 · What to fix (optional)" : "1 · What do you want?"}
        </h3>
        <form action={setDirection}>
          <input type="hidden" name="id" value={job.id} />
          <textarea
            name="brief_notes"
            defaultValue={job.brief_notes ?? ""}
            placeholder={
              isOptimize
                ? "e.g. brighten, declutter the desk, warmer tone — or leave blank for a clean enhance"
                : "e.g. calm reception shots that build trust"
            }
          />
          <button className="btn secondary sm" type="submit" style={{ marginTop: 8 }}>
            Save direction
          </button>
        </form>
        {!isOptimize && (
          <p className="small muted" style={{ marginTop: 10 }}>
            Create mode plans an AI brief from this. Generate the brief in step 3, review,
            then generate.
          </p>
        )}
      </div>

      {/* ── 3 · CHANNELS + settings ── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{isOptimize ? "3" : "2"} · Channels &amp; output</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          One creative → every channel you tick. Re-crops are free.
        </p>
        <form action={setProduction}>
          <input type="hidden" name="id" value={job.id} />
          {PLATFORM_GROUPS.map((g) => (
            <div key={g.family} style={{ marginBottom: 12 }}>
              <div className="small muted" style={{ marginBottom: 6 }}>
                {g.label}
              </div>
              <div className="channel-grid">
                {g.presets.map((p) => (
                  <label key={p.key} className="channel">
                    <input type="checkbox" name="platforms" value={p.key} defaultChecked={selected.has(p.key)} />
                    <span>{p.label}</span>
                    <span className="ratio-chip">{p.ratio}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          <div className="row" style={{ gap: 20, marginTop: 6, flexWrap: "wrap" }}>
            <label className="pill-check" style={{ margin: 0 }}>
              <input type="checkbox" name="logo_enabled" defaultChecked={job.logo_enabled === 1} /> Brand logo
            </label>
            <div className="row" style={{ gap: 6 }}>
              <span className="small muted">at</span>
              <select name="logo_position" defaultValue={job.logo_position} style={{ width: "auto" }}>
                {LOGO_POSITIONS.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos}
                  </option>
                ))}
              </select>
            </div>
            {isOptimize && !isVideoJob && (
              <label className="pill-check" style={{ margin: 0 }}>
                <input type="checkbox" name="combine" defaultChecked={job.combine === 1} /> Combine photos into one
              </label>
            )}
            {isVideoJob && (
              <div className="row" style={{ gap: 6 }}>
                <span className="small muted">video</span>
                <select name="video_mode" defaultValue={job.video_mode} style={{ width: "auto" }}>
                  {isOptimize && <option value="passthrough">size + brand only (no AI)</option>}
                  <option value="animate">animate / generate (AI)</option>
                </select>
              </div>
            )}
          </div>
          <button className="btn secondary sm" type="submit" style={{ marginTop: 12 }}>
            Save channels &amp; output
          </button>
        </form>
      </div>

      {/* ── 4 · GENERATE ── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{isOptimize ? "4" : "3"} · Generate</h3>
        <p className="notice small" style={{ marginBottom: 14 }}>
          {aiCalls === 0
            ? `Resize + brand only — no AI credits used. Delivers ${chWord}.`
            : `${aiCalls} AI generation${aiCalls === 1 ? "" : "s"} → delivered to ${chWord}. Re-crops for every channel are free.`}
        </p>
        <JobActions
          jobId={job.id}
          status={job.status}
          intent={job.intent}
          media={job.media}
          channels={selected.size}
          hasBrief={!!brief}
          assetCount={assets.length}
        />
      </div>

      {/* ── Results ── */}
      <h2>
        Results{" "}
        {deliverables.length > 0 && (
          <span className="small muted">· {deliverables.filter((r) => r.status === "completed").length} ready</span>
        )}
      </h2>
      {pendingMasters.length > 0 && (
        <p className="notice small">
          <span className="spinner" /> Rendering video… this can take a few minutes. The
          page checks automatically.
        </p>
      )}
      {deliverables.length === 0 && pendingMasters.length === 0 ? (
        <p className="muted small">No results yet. Generate above.</p>
      ) : (
        [...groups.entries()].map(([label, rs]) => (
          <div key={label} style={{ marginBottom: 18 }}>
            <div className="small muted" style={{ marginBottom: 6 }}>
              {label}
            </div>
            <div className="grid cols-3">
              {rs.map((r) => {
                const plat = r.platform ? PLATFORMS[r.platform] : undefined;
                const aspectRatio = plat ? `${plat.w} / ${plat.h}` : "1 / 1";
                return (
                  <div className="card" key={r.id} style={{ marginBottom: 0 }}>
                    <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                      <span className="small">{plat?.label ?? r.platform}</span>
                      <span className={`badge ${r.status}`}>{r.status}</span>
                    </div>
                    {r.result_url ? (
                      <>
                        {isVideo(r.result_url) ? (
                          <video className="result-media" style={{ aspectRatio }} src={r.result_url} controls />
                        ) : (
                          <img className="result-media" style={{ aspectRatio }} src={r.result_url} alt={r.platform ?? ""} />
                        )}
                        <div className="row" style={{ marginTop: 8 }}>
                          <a className="btn secondary sm" href={r.result_url} download target="_blank" rel="noreferrer">
                            Download {plat ? `· ${plat.w}×${plat.h}` : ""}
                          </a>
                        </div>
                      </>
                    ) : (
                      <div className="result-media" style={{ aspectRatio, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 8 }}>
                        <span className="small muted">{r.error ? r.error.slice(0, 120) : `${r.status}…`}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* ── AI brief (create) ── */}
      {!isOptimize && (
        <>
          <h2>AI brief {brief && <span className="small muted">· the plan</span>}</h2>
          {!brief ? (
            <p className="muted small">No brief yet — click “Generate brief” above.</p>
          ) : (
            <div className="card">
              <p>
                <strong>Concept.</strong> {brief.concept}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Prompt</th>
                    <th>Caption</th>
                  </tr>
                </thead>
                <tbody>
                  {brief.shots.map((s) => (
                    <tr key={s.index}>
                      <td className="muted">{s.index}</td>
                      <td className="small">{s.prompt}</td>
                      <td className="small">{s.caption}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {briefRow && (
                <details style={{ marginTop: 8 }}>
                  <summary className="small" style={{ cursor: "pointer" }}>
                    Edit brief (raw JSON)
                  </summary>
                  <form action={saveBriefEdit} style={{ marginTop: 12 }}>
                    <input type="hidden" name="brief_id" value={briefRow.id} />
                    <input type="hidden" name="job_id" value={job.id} />
                    <textarea
                      name="content"
                      defaultValue={JSON.stringify(brief, null, 2)}
                      style={{ minHeight: 220, fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}
                    />
                    <button className="btn secondary sm" type="submit" style={{ marginTop: 8 }}>
                      Save edits
                    </button>
                  </form>
                </details>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Director brief PDF (optional) ── */}
      <details className="card">
        <summary style={{ cursor: "pointer" }}>
          Creative director brief (PDF){job.brief_doc_path ? " ✓ attached" : ""}
        </summary>
        <div style={{ marginTop: 12 }}>
          {job.brief_doc_path ? (
            <>
              <p className="small">
                📄{" "}
                {briefDocUrl ? (
                  <a href={briefDocUrl} target="_blank" rel="noreferrer">
                    Director brief (PDF)
                  </a>
                ) : (
                  <span>Director brief (PDF)</span>
                )}{" "}
                <span className="muted">— leads the AI brief.</span>
              </p>
              <form action={removeBriefDoc}>
                <input type="hidden" name="job_id" value={job.id} />
                <button className="btn danger sm" type="submit">
                  Remove PDF
                </button>
              </form>
            </>
          ) : (
            <form action={uploadBriefDoc}>
              <input type="hidden" name="job_id" value={job.id} />
              <input type="file" name="file" accept="application/pdf,.pdf" required />
              <div style={{ marginTop: 10 }}>
                <button className="btn secondary sm" type="submit">
                  Upload brief PDF
                </button>
              </div>
            </form>
          )}
        </div>
      </details>
    </main>
  );
}
