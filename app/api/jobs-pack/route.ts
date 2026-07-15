import { NextRequest, NextResponse } from "next/server";
import {
  checkPackPassword,
  issuePackToken,
  JOBS_PACK_COOKIE,
  JOBS_PACK_PATH,
  JOBS_PACK_TTL_MS,
} from "@/lib/jobsPack";

export const runtime = "nodejs";

// Unlock / lock the external Creative Jobs Pack. This route is exempt from the
// main login gate (see middleware) so external hires can sign in with just the
// pack password — it grants a path-scoped cookie that unlocks nothing else.

// Best-effort in-memory rate limiter: N attempts per IP per rolling window.
// Serverless instances are ephemeral so this resets on cold start — it's a
// damper, not a wall (the 600ms failure sleep does the heavier lifting).
const ATTEMPTS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rateLimited(ip: string, nowMs: number): boolean {
  const hits = (ATTEMPTS.get(ip) ?? []).filter((t) => nowMs - t < WINDOW_MS);
  hits.push(nowMs);
  ATTEMPTS.set(ip, hits);
  return hits.length > MAX_ATTEMPTS;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip, Date.now())) {
    return NextResponse.json({ error: "Too many attempts — wait a minute." }, { status: 429 });
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const ok = await checkPackPassword(body.password ?? "");
  if (!ok) {
    await sleep(600); // blunt brute-force damper
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }

  const token = await issuePackToken();
  if (!token) {
    return NextResponse.json({ error: "Access is not configured." }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(JOBS_PACK_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: JOBS_PACK_PATH, // scoped to the pack — unlocks nothing else
    maxAge: Math.floor(JOBS_PACK_TTL_MS / 1000),
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(JOBS_PACK_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: JOBS_PACK_PATH,
    maxAge: 0,
  });
  return res;
}
