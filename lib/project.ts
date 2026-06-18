import { cookies } from "next/headers";
import { supabase } from "./supabase";

// A project = one brand/workspace (Dental Nation, Cicabelle, …). The brand kit,
// logo, guidelines, assets and jobs are all scoped to a project. The "active"
// project is held in a cookie; pages + create actions read it, while the render
// API routes derive the project from the job they act on (job.project_id).
// Table is namespaced `cd_projects` — the bare `projects` name is used by
// another app sharing this database.

export interface Project {
  id: number;
  name: string;
  slug: string;
  created_at: string;
}

export const PROJECT_COOKIE = "cd_project";

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from("cd_projects").select("*").order("id");
  if (error) console.error("[db] listProjects:", error.message);
  return (data as Project[]) ?? [];
}

export async function getProject(id: number): Promise<Project | undefined> {
  const { data } = await supabase.from("cd_projects").select("*").eq("id", id).maybeSingle();
  return (data as Project) ?? undefined;
}

// The active project id from the cookie, falling back to the first project.
export async function getActiveProjectId(): Promise<number> {
  const raw = (await cookies()).get(PROJECT_COOKIE)?.value;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  const ps = await listProjects();
  return ps[0]?.id ?? 1;
}

export async function getActiveProject(): Promise<Project | undefined> {
  return getProject(await getActiveProjectId());
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project"
  );
}
