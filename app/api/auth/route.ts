import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { signSession, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session";

export const runtime = "nodejs";

// Sign in / sign out. Credentials are verified INSIDE Postgres (bcrypt via
// public.cd_verify_login, service-role only) so no hash ever leaves the DB.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: "Auth is not configured." }, { status: 500 });

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const { data: ok, error } = await supabase.rpc("cd_verify_login", {
    p_email: email,
    p_password: password,
  });
  if (error) return NextResponse.json({ error: "Sign-in is unavailable right now." }, { status: 502 });
  if (ok !== true) {
    await sleep(500); // blunt brute-force damper
    return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  }

  const token = await signSession(email.toLowerCase(), secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
