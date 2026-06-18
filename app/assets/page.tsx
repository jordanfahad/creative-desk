import { listAssets, assetWebPath } from "@/lib/db";
import { uploadAsset, updateAsset, deleteAsset } from "@/lib/actions";
import { getActiveProject } from "@/lib/project";

export const dynamic = "force-dynamic";

const KINDS = ["clinic", "doctor", "product", "other"];
const QUALITIES = ["unrated", "good", "ok", "poor"];

export default async function AssetsPage() {
  const project = await getActiveProject();
  const assets = await listAssets(project?.id ?? 1);

  return (
    <main>
      <h1>Assets</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Upload source photos and clips for <strong>{project?.name ?? "this project"}</strong> and tag
        their quality. They become the source material an optimize job draws from.
      </p>

      <form action={uploadAsset} className="card">
        <h3 style={{ marginTop: 0 }}>Upload</h3>
        <div className="grid cols-3">
          <div>
            <label>File</label>
            <input type="file" name="file" accept="image/*,video/*" required />
          </div>
          <div>
            <label>Kind</label>
            <select name="kind" defaultValue="clinic">
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Quality</label>
            <select name="quality" defaultValue="unrated">
              {QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label>Notes</label>
        <input type="text" name="notes" placeholder="e.g. Front desk, morning light" />
        <div style={{ marginTop: 12 }}>
          <button type="submit" className="btn">
            Upload asset
          </button>
        </div>
      </form>

      <h2>Library ({assets.length})</h2>
      {assets.length === 0 ? (
        <p className="muted">No assets yet.</p>
      ) : (
        <div className="grid cols-3">
          {assets.map((a) => (
            <div className="card" key={a.id} style={{ marginBottom: 0 }}>
              {a.media === "video" ? (
                <video className="thumb" src={assetWebPath(a.local_path)} muted />
              ) : (
                <img className="thumb" src={assetWebPath(a.local_path)} alt={a.filename} />
              )}
              <div className="small muted" style={{ margin: "8px 0 4px" }}>
                #{a.id} · {a.filename}
              </div>
              <form action={updateAsset}>
                <input type="hidden" name="id" value={a.id} />
                <div className="row" style={{ gap: 8 }}>
                  <select name="kind" defaultValue={a.kind} style={{ flex: 1 }}>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <select name="quality" defaultValue={a.quality} style={{ flex: 1 }}>
                    {QUALITIES.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  name="notes"
                  defaultValue={a.notes ?? ""}
                  placeholder="notes"
                  style={{ marginTop: 8 }}
                />
                <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
                  <button type="submit" className="btn secondary sm">
                    Save
                  </button>
                </div>
              </form>
              <form action={deleteAsset} style={{ marginTop: 6 }}>
                <input type="hidden" name="id" value={a.id} />
                <button type="submit" className="btn danger sm">
                  Delete
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
