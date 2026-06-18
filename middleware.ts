import { NextRequest, NextResponse } from "next/server";

// Optional HTTP Basic Auth gate for the whole app — pages, API routes, and
// server actions. It only engages when APP_BASIC_PASS is set, so local dev and
// any build with the var unset are unaffected (fail-open by configuration, not
// by accident). Set APP_BASIC_PASS (and optionally APP_BASIC_USER) on Vercel to
// turn it on; unset it to open the app back up.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};

export function middleware(req: NextRequest) {
  const pass = process.env.APP_BASIC_PASS;
  if (!pass) return NextResponse.next();

  const user = process.env.APP_BASIC_USER || "dental";
  const header = req.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const i = decoded.indexOf(":");
      if (decoded.slice(0, i) === user && decoded.slice(i + 1) === pass) {
        return NextResponse.next();
      }
    } catch {
      /* malformed header — fall through to 401 */
    }
  }
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Creative Desk", charset="UTF-8"' },
  });
}
