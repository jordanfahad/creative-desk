import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import {
  checkPackLinkToken,
  issuePackToken,
  JOBS_PACK_ACCESS_PARAM,
  JOBS_PACK_COOKIE,
  JOBS_PACK_PATH,
  JOBS_PACK_TTL_MS,
} from "@/lib/jobsPack";

// Login gate for the whole app — pages, API routes, and server actions.
// Sessions are HMAC-signed cookies (lib/session.ts) issued by /api/auth after
// a bcrypt check in Postgres. /login and /api/auth stay reachable so you can
// actually sign in. Without SUPABASE_SECRET_KEY (bare local dev) the gate is
// open by configuration — on Vercel the secret is always set.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Expose the path to the root layout (server components can't read it
  // otherwise) so the internal nav can be hidden on the external pack page.
  const passthrough = () => {
    const headers = new Headers(req.headers);
    headers.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers } });
  };

  // The external Creative Jobs Pack has its OWN password gate (lib/jobsPack +
  // /api/jobs-pack), so it's exempt from the main login gate — external hires
  // (designers, marketers, creative directors) never hit the internal sign-in.
  if (pathname === "/download-jobs" || pathname.startsWith("/download-jobs/") || pathname.startsWith("/api/jobs-pack")) {
    // Passwordless share link: `?access=<token>` grants the same path-scoped
    // pack cookie the password would, then REDIRECTS to the clean URL so the
    // token never sits in the address bar, browser history, or a screenshot of
    // someone's phone in a meeting. Anything that isn't a valid token falls
    // straight through to the normal password gate — a wrong or revoked token
    // is indistinguishable from arriving with no token at all.
    const provided = req.nextUrl.searchParams.get(JOBS_PACK_ACCESS_PARAM);
    if (provided && (await checkPackLinkToken(provided))) {
      const token = await issuePackToken();
      if (token) {
        const clean = req.nextUrl.clone();
        clean.searchParams.delete(JOBS_PACK_ACCESS_PARAM);
        const res = NextResponse.redirect(clean);
        res.cookies.set(JOBS_PACK_COOKIE, token, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: JOBS_PACK_PATH,
          maxAge: Math.floor(JOBS_PACK_TTL_MS / 1000),
        });
        return res;
      }
    }
    return passthrough();
  }

  if (pathname === "/login" || pathname.startsWith("/api/auth")) return passthrough();

  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return passthrough();

  const email = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret);
  if (email) return passthrough();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}
