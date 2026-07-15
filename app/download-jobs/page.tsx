import { cookies } from "next/headers";
import { getBrandKit, listGuidelines, resolveDocUrl } from "@/lib/db";
import { JOBS_PACK_COOKIE, verifyPackToken } from "@/lib/jobsPack";
import JobsPackLogin from "./JobsPackLogin";
import LockButton from "./LockButton";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dental Nation · Creative Jobs Pack",
  description: "Brand assets, founder briefs and creative guidelines for external designers, artists, marketers and creative directors.",
};

// Dental Nation is project #1 (the brand kit + guidelines live here).
const DENTAL_NATION_PROJECT_ID = 1;
const WEBSITE_URL = "https://www.dentalnation.com";
const INSTAGRAM_URL = "https://instagram.com/dentalnation";

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
  } catch {
    // tolerate a plain comma-separated string
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

// Readable ink for a swatch — light text on dark colours, dark on light.
function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#20303f";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#20303f" : "#ffffff";
}

export default async function DownloadJobsPage() {
  // Own password gate — external hires never touch the internal login.
  const token = (await cookies()).get(JOBS_PACK_COOKIE)?.value;
  const unlocked = await verifyPackToken(token);
  if (!unlocked) return <JobsPackLogin />;

  const brand = await getBrandKit(DENTAL_NATION_PROJECT_ID);
  const guidelines = await listGuidelines(DENTAL_NATION_PROJECT_ID);

  const colors = parseList(brand?.colors ?? null);
  const fonts = parseList(brand?.fonts ?? null);
  const guardrails = parseList(brand?.do_not_say ?? null);

  // Resolve signed URLs for the founder / brand document PDFs (private bucket).
  const docs = guidelines.filter((g) => g.active && g.doc_path);
  const docLinks = await Promise.all(
    docs.map(async (g) => ({
      id: g.id,
      title: g.title,
      source: g.source,
      url: await resolveDocUrl(g.doc_path),
    })),
  );

  const sourceLabel = (s: string) =>
    s === "ceo" ? "Founder" : s === "creative" ? "Creative team" : "Brand";

  return (
    <main>
      {/* Hero */}
      <div className="card entry" style={{ padding: "26px 24px" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            <svg width="34" height="34" viewBox="0 0 22 22" aria-hidden="true">
              <rect x="0" y="0" width="22" height="22" rx="6" fill="#244260" />
              <path d="M5.5 9 Q11 16 16.5 9" fill="none" stroke="#cfe2d0" strokeWidth="2" strokeLinecap="round" />
              <circle cx="11" cy="5.6" r="1.3" fill="#5793a3" />
            </svg>
            <div>
              <h1 style={{ margin: 0 }}>Dental Nation · Creative Jobs Pack</h1>
              <div className="muted" style={{ fontSize: 14 }}>
                {brand?.tagline ?? "Beyond Smiles"}
              </div>
            </div>
          </div>
          <LockButton />
        </div>
        <p style={{ marginBottom: 0, maxWidth: 760 }}>
          Welcome — this is the working brief for designers, artists, digital marketers and creative
          directors we hire. Everything you need to create on-brand is here: the logo, palette, fonts,
          the founder briefs, the brand book, and where to look for inspiration.
        </p>
        {brand?.boilerplate && (
          <p className="muted small" style={{ marginBottom: 0, marginTop: 10 }}>
            {brand.boilerplate}
          </p>
        )}
      </div>

      {/* Logo */}
      <h2>Logo</h2>
      <div className="card">
        {brand?.logo_path ? (
          <div className="row" style={{ gap: 22, alignItems: "center" }}>
            <img
              src={brand.logo_path}
              alt="Dental Nation logo"
              style={{
                width: 220,
                maxWidth: "100%",
                height: 120,
                objectFit: "contain",
                background: "#fff",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 16,
              }}
            />
            <div>
              <p className="small muted" style={{ marginTop: 0 }}>
                Primary logo — navy on transparent. Use it with clear space around it; never stretch,
                recolour or add effects.
              </p>
              <a href={brand.logo_path} download className="btn secondary sm" target="_blank" rel="noreferrer">
                ⬇ Download logo (PNG)
              </a>
            </div>
          </div>
        ) : (
          <p className="muted small">Logo unavailable — ask your point of contact.</p>
        )}
      </div>

      {/* Brand kit — colours + fonts */}
      <h2>Dental Nation brand kit</h2>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Brand colours</h3>
        {colors.length ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: 12,
            }}
          >
            {colors.map((hex) => (
              <div
                key={hex}
                style={{
                  background: hex,
                  color: inkFor(hex),
                  border: "1px solid var(--border)",
                  borderRadius: 11,
                  padding: "22px 12px 12px",
                  minHeight: 84,
                  display: "flex",
                  alignItems: "flex-end",
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 600,
                  fontSize: 13,
                  letterSpacing: 0.3,
                }}
              >
                {hex.toUpperCase()}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">No colours set.</p>
        )}

        <h3>Fonts</h3>
        {fonts.length ? (
          <div className="row" style={{ gap: 10 }}>
            {fonts.map((f, i) => (
              <div
                key={f}
                style={{
                  border: "1px solid var(--border-strong)",
                  borderRadius: 10,
                  padding: "12px 16px",
                  minWidth: 150,
                }}
              >
                <div style={{ fontSize: 22, fontFamily: `${f}, ui-sans-serif, system-ui, sans-serif` }}>Aa</div>
                <div className="small" style={{ fontWeight: 650, color: "var(--heading)" }}>{f}</div>
                <div className="small muted">{i === 0 ? "Primary" : "Secondary / display"}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">No fonts set.</p>
        )}
      </div>

      {/* Website details */}
      <h2>Website details</h2>
      <div className="card">
        <table>
          <tbody>
            <tr>
              <th style={{ width: 160 }}>Website</th>
              <td>
                <a href={WEBSITE_URL} target="_blank" rel="noreferrer">
                  {WEBSITE_URL.replace(/^https?:\/\//, "")}
                </a>
              </td>
            </tr>
            <tr>
              <th>Instagram</th>
              <td>
                <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer">
                  @dentalnation
                </a>
              </td>
            </tr>
            <tr>
              <th>Tagline</th>
              <td>{brand?.tagline ?? "Beyond Smiles"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Founder & brand documents */}
      <h2>Founder &amp; brand documents</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Read these first — they explain what Dental Nation is building and how the brand behaves.
        Links are private and expire; reopen this page for a fresh one.
      </p>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 130 }}>Type</th>
              <th>Document</th>
              <th style={{ width: 130 }}></th>
            </tr>
          </thead>
          <tbody>
            {docLinks.map((d) => (
              <tr key={d.id}>
                <td>
                  <span className={`badge ${d.source === "ceo" ? "approved" : d.source === "creative" ? "briefed" : ""}`}>
                    {sourceLabel(d.source)}
                  </span>
                </td>
                <td style={{ fontWeight: 600, color: "var(--heading)" }}>{d.title}</td>
                <td>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="btn secondary sm">
                      📄 Open PDF
                    </a>
                  ) : (
                    <span className="small muted">unavailable</span>
                  )}
                </td>
              </tr>
            ))}
            {docLinks.length === 0 && (
              <tr>
                <td colSpan={3} className="muted small">
                  No documents available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Creative guidelines summary */}
      <h2>Creative guidelines summary</h2>
      <div className="card">
        {brand?.voice && (
          <>
            <h3 style={{ marginTop: 0 }}>Voice &amp; tone</h3>
            <p style={{ marginTop: 0 }}>{brand.voice}</p>
          </>
        )}
        {guardrails.length > 0 && (
          <>
            <h3>Never do this</h3>
            <ul style={{ margin: "0 0 4px", paddingLeft: 20 }}>
              {guardrails.map((g) => (
                <li key={g} className="small" style={{ marginBottom: 4 }}>
                  {g}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="notice" style={{ marginTop: 14 }}>
          Premium-but-accessible and trust-led — calm confidence, never hype or discounting. Dubai-born,
          GCC-built. When translating a benchmark brand, translate the <em>pattern</em>, never copy the
          copy, icons or claims.
        </div>
      </div>

      {/* Inspiration */}
      <h2>Inspiration</h2>
      <div className="grid cols-2">
        <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className="card entry" style={{ textDecoration: "none", display: "block" }}>
          <div style={{ fontWeight: 700, color: "var(--heading)", fontSize: 16 }}>Instagram — @dentalnation</div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            See the live feed for tone, composition and how posts come together. Match this energy.
          </p>
        </a>
        <a href={WEBSITE_URL} target="_blank" rel="noreferrer" className="card entry" style={{ textDecoration: "none", display: "block" }}>
          <div style={{ fontWeight: 700, color: "var(--heading)", fontSize: 16 }}>Website — dentalnation.com</div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            The full brand world: services, photography style, colour and typography in context.
          </p>
        </a>
      </div>

      <p className="muted small" style={{ marginTop: 24, textAlign: "center" }}>
        Dental Nation · shared privately for hiring — please keep it confidential.
      </p>
    </main>
  );
}
