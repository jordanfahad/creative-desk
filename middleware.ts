import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

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
  if (pathname === "/login" || pathname.startsWith("/api/auth")) return NextResponse.next();

  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return NextResponse.next();

  const email = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret);
  if (email) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}
