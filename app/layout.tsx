import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "Creative Desk · Dental Nation",
  description: "On-brand creative production for Dental Nation — optimize and create for every channel.",
};

// Small brand mark: a navy rounded square with a mint "smile" arc — evokes
// Dental Nation ("Beyond Smiles") without depending on the uploaded logo.
function BrandMark() {
  return (
    <svg className="brand-mark" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="0" y="0" width="22" height="22" rx="6" fill="#244260" />
      <path d="M5.5 9 Q11 16 16.5 9" fill="none" stroke="#cfe2d0" strokeWidth="2" strokeLinecap="round" />
      <circle cx="11" cy="5.6" r="1.3" fill="#5793a3" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="brand">
            <BrandMark />
            <span>
              Creative Desk <span className="sub">· Dental Nation</span>
            </span>
          </Link>
          <span className="spacer" />
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
