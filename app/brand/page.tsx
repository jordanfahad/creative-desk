import { getBrandKit, listGuidelines, listLogos, listCharacters, listLocations, assetWebPath, resolveDocUrl } from "@/lib/db";
import { getActiveProject } from "@/lib/project";
import {
  saveBrandKit,
  uploadLogo,
  removeLogo,
  setDefaultLogo,
  uploadLibraryAsset,
  removeLibraryAsset,
  addGuideline,
  uploadGuideline,
  toggleGuideline,
  deleteGuideline,
} from "@/lib/actions";

export const dynamic = "force-dynamic";

const SOURCES = [
  { value: "ceo", label: "CEO" },
  { value: "creative", label: "Creative team" },
  { value: "general", label: "General" },
];
const sourceLabel = (s: string) => SOURCES.find((x) => x.value === s)?.label ?? "General";

function jsonToCsv(raw: string | null): string {
  if (!raw) return "";
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.join(", ") : "";
  } catch {
    return "";
  }
}

export default async function BrandPage() {
  const project = await getActiveProject();
  const pid = project?.id ?? 1;
  const brand = await getBrandKit(pid);
  const guidelines = await listGuidelines(pid);
  const logos = await listLogos(pid);
  const characters = await listCharacters(pid);
  const locations = await listLocations(pid);
  // Confidential guideline PDFs are served via short-lived signed URLs.
  const docUrls = new Map<number, string>();
  await Promise.all(
    guidelines
      .filter((g) => g.doc_path)
      .map(async (g) => {
        const url = await resolveDocUrl(g.doc_path);
        if (url) docUrls.set(g.id, url);
      }),
  );

  return (
    <main>
      <h1>{project?.name ?? "Brand kit"} · Brand kit</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Set once for this project — logo, palette, voice, guardrails and guidelines are
        re-injected into every prompt for <strong>{project?.name ?? "this brand"}</strong>. Switch
        projects from the top bar to manage another brand.
      </p>

      <form action={saveBrandKit} className="card">
        <div className="grid cols-2">
          <div>
            <label>Clinic name</label>
            <input type="text" name="clinic_name" defaultValue={brand?.clinic_name ?? ""} />
          </div>
          <div>
            <label>Tagline</label>
            <input type="text" name="tagline" defaultValue={brand?.tagline ?? ""} />
          </div>
        </div>

        <label>Voice / tone</label>
        <textarea name="voice" defaultValue={brand?.voice ?? ""} />

        <div className="grid cols-2">
          <div>
            <label>Brand colors (comma-separated hex)</label>
            <input type="text" name="colors" defaultValue={jsonToCsv(brand?.colors ?? null)} />
          </div>
          <div>
            <label>Fonts (comma-separated)</label>
            <input type="text" name="fonts" defaultValue={jsonToCsv(brand?.fonts ?? null)} />
          </div>
        </div>

        <label>Hard guardrails — never imply/claim (comma-separated)</label>
        <input type="text" name="do_not_say" defaultValue={jsonToCsv(brand?.do_not_say ?? null)} />

        <label>Boilerplate</label>
        <textarea name="boilerplate" defaultValue={brand?.boilerplate ?? ""} />

        <div style={{ marginTop: 14 }}>
          <button type="submit" className="btn">
            Save brand kit
          </button>
          {brand?.updated_at && (
            <span className="small muted" style={{ marginLeft: 12 }}>
              updated {brand.updated_at}
            </span>
          )}
        </div>
      </form>

      <h2>Logos</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Add as many variations as you need — primary, a white / reversed version for dark
        backgrounds, an icon-only mark, etc. A transparent <strong>PNG</strong> works best. One is the{" "}
        <strong>default</strong>; pick which variation (and the corner) per job.
      </p>
      <div className="card">
        {logos.length > 0 && (
          <div className="grid cols-3" style={{ marginBottom: 18 }}>
            {logos.map((l) => (
              <div key={l.id}>
                <img
                  src={assetWebPath(l.path)}
                  alt={l.label}
                  style={{ width: "100%", height: 92, objectFit: "contain", background: "#fff", borderRadius: 8, padding: 8, border: "1px solid var(--border)" }}
                />
                <div className="row" style={{ justifyContent: "space-between", margin: "8px 0 6px", alignItems: "center" }}>
                  <span className="small">
                    <strong>{l.label}</strong>
                  </span>
                  {l.is_default === 1 && <span className="badge done">default</span>}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {l.is_default !== 1 && (
                    <form action={setDefaultLogo}>
                      <input type="hidden" name="logo_id" value={l.id} />
                      <button className="btn secondary sm" type="submit">
                        Make default
                      </button>
                    </form>
                  )}
                  <form action={removeLogo}>
                    <input type="hidden" name="logo_id" value={l.id} />
                    <button className="btn danger sm" type="submit">
                      Remove
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
        <form action={uploadLogo}>
          <div className="grid cols-2">
            <div>
              <label style={{ marginTop: 0 }}>Logo file (transparent PNG)</label>
              <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required />
            </div>
            <div>
              <label style={{ marginTop: 0 }}>Label</label>
              <input type="text" name="label" placeholder="e.g. Primary, White, Icon" />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn" type="submit">
              {logos.length ? "Add another logo" : "Add logo"}
            </button>
          </div>
        </form>
      </div>

      <h2>Team &amp; characters</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Upload real photos (or short clips) of your <strong>own doctors, hygienists and team</strong> —
        ideally clean studio portraits in your branded gowns. Add them once here, then pull any of them
        into a reel (from the job&apos;s <strong>“Add from Team”</strong> picker) and the reel animates
        those <strong>real people</strong> — same face, real uniform, real logo — instead of a generated
        stranger. This is the most realistic, on-brand result.
      </p>
      <div className="card">
        {characters.length > 0 && (
          <div className="grid cols-3" style={{ marginBottom: 18 }}>
            {characters.map((c) => (
              <div key={c.id}>
                {c.media === "video" ? (
                  <video
                    src={assetWebPath(c.local_path)}
                    muted
                    playsInline
                    style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", background: "#000" }}
                  />
                ) : (
                  <img
                    src={assetWebPath(c.local_path)}
                    alt={c.filename}
                    style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                )}
                <div className="row" style={{ justifyContent: "space-between", margin: "8px 0 6px", alignItems: "center" }}>
                  <span className="small">
                    <strong>{c.filename}</strong> <span className="muted">· {c.media}</span>
                  </span>
                </div>
                <form action={removeLibraryAsset}>
                  <input type="hidden" name="asset_id" value={c.id} />
                  <button className="btn danger sm" type="submit">
                    Remove
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
        <form action={uploadLibraryAsset}>
          <input type="hidden" name="category" value="character" />
          <div className="grid cols-2">
            <div>
              <label style={{ marginTop: 0 }}>Photo or video</label>
              <input type="file" name="file" accept="image/*,video/*" multiple required />
            </div>
            <div>
              <label style={{ marginTop: 0 }}>Name (optional)</label>
              <input type="text" name="name" placeholder="e.g. Dr. Ahmad" />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn" type="submit">
              {characters.length ? "Add more team members" : "Add team member"}
            </button>
          </div>
        </form>
      </div>

      <h2>Clinic &amp; locations</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Upload real photos (or clips) of your <strong>clinics, rooms, reception and equipment</strong>.
        Pull them into a reel from <strong>“Add from Team &amp; clinic”</strong> and they become
        cinematic B-roll — real rooms, real brand — that intercuts with your doctors for a premium,
        varied reel (not just talking heads).
      </p>
      <div className="card">
        {locations.length > 0 && (
          <div className="grid cols-3" style={{ marginBottom: 18 }}>
            {locations.map((c) => (
              <div key={c.id}>
                {c.media === "video" ? (
                  <video
                    src={assetWebPath(c.local_path)}
                    muted
                    playsInline
                    style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", background: "#000" }}
                  />
                ) : (
                  <img
                    src={assetWebPath(c.local_path)}
                    alt={c.filename}
                    style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                )}
                <div className="row" style={{ justifyContent: "space-between", margin: "8px 0 6px", alignItems: "center" }}>
                  <span className="small">
                    <strong>{c.filename}</strong> <span className="muted">· {c.media}</span>
                  </span>
                </div>
                <form action={removeLibraryAsset}>
                  <input type="hidden" name="asset_id" value={c.id} />
                  <button className="btn danger sm" type="submit">
                    Remove
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
        <form action={uploadLibraryAsset}>
          <input type="hidden" name="category" value="location" />
          <div className="grid cols-2">
            <div>
              <label style={{ marginTop: 0 }}>Photo or video</label>
              <input type="file" name="file" accept="image/*,video/*" multiple required />
            </div>
            <div>
              <label style={{ marginTop: 0 }}>Label (optional)</label>
              <input type="text" name="name" placeholder="e.g. Al Wasl reception" />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn" type="submit">
              {locations.length ? "Add more clinic media" : "Add clinic photo / video"}
            </button>
          </div>
        </form>
      </div>

      <h2>Guidelines</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Only <strong>active</strong> guidelines are injected. Toggle off to retire
        one without deleting it.
      </p>

      {guidelines.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Title</th>
                <th>Body</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {guidelines.map((g) => (
                <tr key={g.id}>
                  <td>
                    <span className={`badge ${g.source === "ceo" ? "approved" : "briefed"}`}>
                      {sourceLabel(g.source)}
                    </span>
                  </td>
                  <td>
                    {g.title}
                    {docUrls.has(g.id) && (
                      <>
                        {" "}
                        <a href={docUrls.get(g.id)} target="_blank" rel="noreferrer" className="small">
                          📄 PDF
                        </a>
                      </>
                    )}
                  </td>
                  <td className="muted small">
                    {g.body.length > 160 ? g.body.slice(0, 160) + "…" : g.body}
                  </td>
                  <td>
                    <form action={toggleGuideline}>
                      <input type="hidden" name="id" value={g.id} />
                      <button type="submit" className="btn secondary sm">
                        {g.active ? "on" : "off"}
                      </button>
                    </form>
                  </td>
                  <td>
                    <form action={deleteGuideline}>
                      <input type="hidden" name="id" value={g.id} />
                      <button type="submit" className="btn danger sm">
                        delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid cols-2">
        {/* Upload a guideline document (creative team / CEO) */}
        <form action={uploadGuideline} className="card">
          <h3 style={{ marginTop: 0 }}>Upload guideline (PDF)</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            Creative guidelines or a CEO directive. The text is extracted and
            re-injected into every brief. CEO directives are weighted highest.
          </p>
          <label>Source</label>
          <select name="source" defaultValue="creative">
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <label>Title (optional — defaults to filename)</label>
          <input type="text" name="title" placeholder="e.g. 2026 Creative Playbook" />
          <label>PDF</label>
          <input type="file" name="file" accept="application/pdf,.pdf" required />
          <div style={{ marginTop: 12 }}>
            <button type="submit" className="btn">
              Upload guideline
            </button>
          </div>
        </form>

        {/* Type a short guideline by hand */}
        <form action={addGuideline} className="card">
          <h3 style={{ marginTop: 0 }}>Add guideline (text)</h3>
          <label>Source</label>
          <select name="source" defaultValue="creative">
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <label>Title</label>
          <input type="text" name="title" placeholder="e.g. Trust over flash" />
          <label>Body</label>
          <textarea name="body" placeholder="The directive the model should follow…" />
          <div style={{ marginTop: 12 }}>
            <button type="submit" className="btn">
              Add guideline
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
