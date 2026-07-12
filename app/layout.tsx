import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import "./globals.css";
import { listProjects, getActiveProjectId } from "@/lib/project";
import { switchProject, signOut } from "@/lib/actions";
import { SESSION_COOKIE } from "@/lib/session";
import ProjectSwitcher from "./ProjectSwitcher";

export const metadata = {
  title: "Creative Desk",
  description: "On-brand creative production for every project — optimize and create for every channel.",
};

// Small brand mark: a navy rounded square with a mint "smile" arc.
function BrandMark() {
  return (
    <svg className="brand-mark" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="0" y="0" width="22" height="22" rx="6" fill="#244260" />
      <path d="M5.5 9 Q11 16 16.5 9" fill="none" stroke="#cfe2d0" strokeWidth="2" strokeLinecap="round" />
      <circle cx="11" cy="5.6" r="1.3" fill="#5793a3" />
    </svg>
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [projects, activeId] = await Promise.all([listProjects(), getActiveProjectId()]);
  const authed = Boolean((await cookies()).get(SESSION_COOKIE)?.value);

  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="brand">
            <BrandMark />
            <span>Creative Desk</span>
          </Link>
          {projects.length > 0 && (
            <ProjectSwitcher projects={projects} activeId={activeId} switchAction={switchProject} />
          )}
          <span className="spacer" />
          <Link href="/">Jobs</Link>
          <Link href="/jobs/new">New job</Link>
          <Link href="/assets">Assets</Link>
          <Link href="/brand">Brand kit</Link>
          <Link href="/projects">Projects</Link>
          <Link href="/knowledge">Knowledge</Link>
          {authed && (
            <form action={signOut} style={{ display: "inline", margin: 0 }}>
              <button
                type="submit"
                style={{ background: "none", border: 0, padding: 0, color: "inherit", font: "inherit", cursor: "pointer", opacity: 0.7 }}
              >
                Sign out
              </button>
            </form>
          )}
        </nav>
        <div className="container">{children}</div>
      </body>
    </html>
  );
}
