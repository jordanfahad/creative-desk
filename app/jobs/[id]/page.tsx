import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getJob,
  getLatestBrief,
  listRenders,
  getAssetsByIds,
  listLogos,
  assetWebPath,
  resolveDocUrl,
  jobPlatformKeys,
  jobInspirationIds,
} from "@/lib/db";
import { parseBrief, type Brief } from "@/lib/context";
import {
  deleteJob,
  saveBriefEdit,
  uploadBriefDoc,
  removeBriefDoc,
  setProduction,
  setDirection,
  setJobGoal,
  removeJobAsset,
  uploadJobInspiration,
  removeJobInspiration,
  setInspirationNote,
} from "@/lib/actions";
import { PLATFORM_GROUPS, PLATFORMS, LOGO_POSITIONS } from "@/lib/platform";
import { STYLE_PRESETS } from "@/lib/style";
import JobActions from "./JobActions";
import GoalPicker from "./GoalPicker";
import { JobAssetUpload } from "@/components/JobAssetUpload";
import { MusicPicker } from "@/components/MusicPicker";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  briefed: "Planned",
  approved: "Approved",
  submitted: "Rendering",
  done: "Ready",
  failed: "Failed",
};

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
  const inspiration = (await getAssetsByIds(jobInspirationIds(job))).filter((a) => a.media !== "video");
  const logos = await listLogos(job.project_id);
  const briefDocUrl = await resolveDocUrl(job.brief_doc_path);
  const selected = new Set(jobPlatformKeys(job));
  const isOptimize = job.intent === "optimize";
  const isVideoJob = job.media === "video";
  const isMontage = isVideoJob && job.video_mode === "montage";

  // Step numbers flow top-to-bottom over whichever cards this job type shows.
  let stepNo = 0;
  const step = () => ++stepNo;

  const inspirationCard = () => (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{step()} · Inspiration — “make it like this” (optional)</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Add up to 3 example creatives whose <strong>look</strong> you want. We borrow their style —
        light, palette, composition, mood — never their content. Tell each one what to borrow.
      </p>
      {inspiration.length > 0 && (
        <div className="grid cols-3" style={{ marginBottom: 12 }}>
          {inspiration.map((a) => (
            <div key={a.id}>
              <img className="thumb" src={assetWebPath(a.local_path)} alt={a.filename} />
              <form action={setInspirationNote} style={{ marginTop: 6 }}>
                <input type="hidden" name="job_id" value={job.id} />
                <input type="hidden" name="asset_id" value={a.id} />
                <input
                  name="note"
                  defaultValue={a.notes ?? ""}
                  placeholder="what to borrow — e.g. this color grade & lighting"
                />
                <div className="row" style={{ marginTop: 4 }}>
                  <button className="btn secondary sm" type="submit">
                    Save note
                  </button>
                </div>
              </form>
              <form action={removeJobInspiration} style={{ marginTop: 4 }}>
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
      {inspiration.length < 3 ? (
        <form action={uploadJobInspiration}>
          <input type="hidden" name="job_id" value={job.id} />
          <input type="file" name="file" accept="image/*" multiple required />
          <div style={{ marginTop: 8 }}>
            <input name="note" placeholder="what to borrow (optional) — applies to these uploads" />
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn" type="submit">
              + Add inspiration
            </button>
          </div>
        </form>
      ) : (
        <p className="small muted" style={{ marginBottom: 0 }}>
          3 of 3 references added — remove one to add another.
        </p>
      )}
    </div>
  );

  const photoAssets = assets.filter((a) => a.media !== "video");
  const videoAssets = assets.filter((a) => a.media === "video");

  // Spend estimate: paid AI generations only — channel re-crops are free.
  const imageAssetCount = photoAssets.length;
  let aiCalls = 0;
  if (isMontage) aiCalls = 0; // deterministic pan/zoom render — no AI credits
  else if (!isOptimize) aiCalls = brief ? brief.shots.length : 0;
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

      {/* ── SOURCE ── image-optimize: photos. video: photos (→montage) always,
          plus an existing-clip uploader on optimize. Image-create: none. ── */}
      {(isOptimize || isVideoJob) && (
        <div className="card" style={{ marginTop: 18 }}>
          <h3 style={{ marginTop: 0 }}>{step()} · Your {isVideoJob ? "source" : "photos"}</h3>

          {isVideoJob ? (
            <>
              {/* Photos → montage video */}
              <p className="small muted" style={{ marginTop: 0 }}>
                <strong>Photos → video.</strong> Upload photos (up to ~10) and they’re assembled into
                one branded montage — the AI curates which to use, their order, pacing and motion,
                then it’s cropped to every channel. No AI credits.
              </p>
              {photoAssets.length > 0 && (
                <div className="grid cols-3" style={{ marginBottom: 12 }}>
                  {photoAssets.map((a) => (
                    <div key={a.id}>
                      <img className="thumb" src={assetWebPath(a.local_path)} alt={a.filename} />
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
              <JobAssetUpload jobId={job.id} accept="image/*" buttonLabel="+ Add photos" />

              {/* Existing clip → enhance (optimize only) */}
              {isOptimize && (
                <div style={{ marginTop: 18, borderTop: "1px solid var(--line, #e5e7eb)", paddingTop: 14 }}>
                  <p className="small muted" style={{ marginTop: 0 }}>
                    <strong>Or an existing clip.</strong> Upload a video to enhance, resize to every
                    channel, and logo-stamp (no montage).
                  </p>
                  {videoAssets.length > 0 && (
                    <div className="grid cols-3" style={{ marginBottom: 12 }}>
                      {videoAssets.map((a) => (
                        <div key={a.id}>
                          <video className="thumb" src={assetWebPath(a.local_path)} muted />
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
                  <JobAssetUpload jobId={job.id} accept="video/*" buttonLabel="+ Add video" />
                </div>
              )}
                            {isMontage && <MusicPicker jobId={job.id} current={job.music_track ?? ""} />}

              <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
                Mode: <strong>{job.video_mode === "montage" ? "photo montage" : job.video_mode === "passthrough" ? "enhance video" : "AI video"}</strong>
                {" "}— set automatically from what you upload; change it under “Channels &amp; output”.
              </p>
            </>
          ) : (
            <>
              <p className="small muted" style={{ marginTop: 0 }}>
                Upload the image(s) to fix &amp; optimize — each is edited on-brand, cropped to every
                channel, and logo-stamped.
              </p>
              {photoAssets.length > 0 && (
                <div className="grid cols-3" style={{ marginBottom: 12 }}>
                  {photoAssets.map((a) => (
                    <div key={a.id}>
                      <img className="thumb" src={assetWebPath(a.local_path)} alt={a.filename} />
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
              <JobAssetUpload jobId={job.id} accept="image/*" buttonLabel="+ Add photos" />
            </>
          )}
        </div>
      )}

      {/* ── INSPIRATION (image jobs; optimize flow puts it right after the photos) ── */}
      {!isVideoJob && isOptimize && inspirationCard()}

      {/* ── DIRECTION ── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>
          {step()} · {isOptimize ? "What to fix (optional)" : "What do you want?"}
        </h3>
        <form action={setDirection}>
          <input type="hidden" name="id" value={job.id} />
          <textarea
            name="brief_notes"
            defaultValue={job.brief_notes ?? ""}
            placeholder={
              isMontage
                ? "e.g. showcase the Lane E lifestyle — calm, premium, human"
                : isOptimize
                  ? "e.g. brighten, declutter the desk, warmer tone — or leave blank for a clean enhance"
                  : "e.g. calm reception shots that build trust"
            }
          />
          <button className="btn secondary sm" type="submit" style={{ marginTop: 10 }}>
            Save direction
          </button>
        </form>
        <div style={{ marginTop: 12 }}>
          <GoalPicker jobId={job.id} value={job.funnel_goal ?? ""} action={setJobGoal} />
          <p className="small muted" style={{ marginTop: 4 }}>Goal saves automatically when you pick it.</p>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Next, click <strong>✨ Optimize prompt with AI</strong> below — it rewrites this into a
          brand-aligned, production-grade {isVideoJob ? "video" : "image"} prompt before generating.
        </p>
      </div>

      {/* ── INSPIRATION (create flow: after the direction it steers) ── */}
      {!isVideoJob && !isOptimize && inspirationCard()}

      {/* ── CHANNELS + settings ── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{step()} · Channels &amp; output</h3>
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
            {!isOptimize && !isMontage && (
              <div className="row" style={{ gap: 6 }}>
                <span className="small muted">format</span>
                <select name="carousel_count" defaultValue={String(job.carousel_count ?? 1)} style={{ width: "auto" }}>
                  <option value="1">Single {isVideoJob ? "clip" : "image"}</option>
                  <option value="2">Carousel · 2 slides</option>
                  <option value="3">Carousel · 3 slides</option>
                  <option value="4">Carousel · 4 slides</option>
                  <option value="5">Carousel · 5 slides</option>
                  <option value="6">Carousel · 6 slides</option>
                </select>
              </div>
            )}
            <div className="row" style={{ gap: 6 }}>
              <span className="small muted">style</span>
              <select name="style" defaultValue={job.style} style={{ width: "auto" }}>
                {STYLE_PRESETS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="pill-check" style={{ margin: 0 }}>
              <input type="checkbox" name="logo_enabled" defaultChecked={job.logo_enabled === 1} /> Brand logo
            </label>
            {logos.length > 1 && (
              <div className="row" style={{ gap: 6 }}>
                <span className="small muted">use</span>
                <select name="logo_id" defaultValue={job.logo_id ?? ""} style={{ width: "auto" }}>
                  <option value="">Default</option>
                  {logos.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
                  <option value="montage">photo montage — images → video (no AI credits)</option>
                </select>
              </div>
            )}
          </div>
          <button className="btn secondary sm" type="submit" style={{ marginTop: 12 }}>
            Save channels &amp; output
          </button>
        </form>
      </div>

      {/* ── GENERATE ── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{step()} · Generate</h3>
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
          videoMode={job.video_mode}
          channels={selected.size}
          hasBrief={!!brief}
          assetCount={assets.length}
          imageAssetCount={imageAssetCount}
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

      {/* ── AI-optimized prompt (both intents) ── */}
      <>
          <h2>
            ✨ AI-optimized prompt{" "}
            {brief && <span className="small muted">· exactly what the renderer receives</span>}
          </h2>
          {!brief ? (
            <p className="muted small">
              Not optimized yet — click <strong>✨ Optimize prompt with AI</strong> above. It turns your
              direction + brand guidelines + CEO input into a production-grade prompt for much better results.
            </p>
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
