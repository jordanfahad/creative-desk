import { getBrandKit, listGuidelines, listLogos, assetWebPath, resolveDocUrl } from "@/lib/db";
import { getActiveProject } from "@/lib/project";
import {
  saveBrandKit,
  uploadLogo,
  removeLogo,
  setDefaultLogo,
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
