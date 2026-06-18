import Link from "next/link";
import { listProjects, getActiveProjectId } from "@/lib/project";
import { createProject, switchProject } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await listProjects();
  const activeId = await getActiveProjectId();

  return (
    <main>
      <h1>Projects</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Each project is a separate brand — its own logo, palette, voice, guidelines, assets and
        jobs. Add one per brand (Dental Nation, Cicabelle, …) and switch between them anytime.
      </p>

      {projects.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Slug</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>{" "}
                    {p.id === activeId && <span className="badge done">active</span>}
                  </td>
                  <td className="muted small">/{p.slug}</td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                      {p.id !== activeId && (
                        <form action={switchProject}>
                          <input type="hidden" name="project_id" value={p.id} />
                          <button className="btn secondary sm" type="submit">
                            Switch to
                          </button>
                        </form>
                      )}
                      {p.id === activeId && (
                        <Link href="/brand" className="btn secondary sm">
                          Brand kit
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>New project</h2>
      <form action={createProject} className="card">
        <label>Brand / project name</label>
        <input type="text" name="name" placeholder="e.g. Cicabelle" required />
        <p className="small muted" style={{ marginTop: 10 }}>
          Creates an empty brand kit you fill in next (logo, palette, voice, guidelines) and switches
          you to it. Everything you generate after that is scoped to this brand.
        </p>
        <button className="btn" type="submit">
          Create project
        </button>
      </form>
    </main>
  );
}
