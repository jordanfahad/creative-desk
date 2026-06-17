import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "Creative Desk",
  description: "Internal creative production desk for the dental clinics.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="brand" style={{ color: "var(--text)" }}>
            🎬 Creative Desk
          </Link>
          <Link href="/">Jobs</Link>
          <Link href="/jobs/new">New job</Link>
          <Link href="/assets">Assets</Link>
          <Link href="/brand">Brand kit</Link>
        </nav>
        <div className="container">{children}</div>
      </body>
    </html>
  );
}
