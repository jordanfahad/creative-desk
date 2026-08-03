// Standalone password gate for the external Creative Jobs Pack (/download-jobs).
// This is DELIBERATELY separate from the main Creative Desk login: external
// hires (designers, artists, marketers, creative directors) get a single
// shareable link + one password, and see ONLY the pack — never the internal
// app. Mirrors the pattern of the standalone Araby report gate on the dashboard.
//
// The password is never stored in the repo as plaintext — only its SHA-256
// hash. Override in production with JOBS_PACK_PASSWORD (plaintext) or
// JOBS_PACK_PASSWORD_SHA256 (a precomputed hash). The access cookie is an
// HMAC-signed token (reusing lib/session's proven crypto) scoped to the
// /download-jobs path, so it can never unlock the rest of the app.

import { signSession, verifySession } from "./session";

// Cookie is path-scoped to the pack — it grants nothing elsewhere.
export const JOBS_PACK_COOKIE = "cd_jobs_pack";
export const JOBS_PACK_PATH = "/download-jobs";
export const JOBS_PACK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Fixed subject signed into the token — verification just checks it matches.
const SUBJECT = "jobs-pack";

// SHA-256 of the access password. The plaintext lives only in the operator's
// head and the env, never here. Rotate by setting JOBS_PACK_PASSWORD in Vercel.
const DEFAULT_PASSWORD_SHA256 =
  "2490ec1332176afe904b94234212624abd169ed4f51a4a6adb2d5efb8e46da5f";

const enc = new TextEncoder();

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The expected password hash — env override wins, else the baked-in default. */
async function expectedHash(): Promise<string> {
  const plain = process.env.JOBS_PACK_PASSWORD;
  if (plain) return sha256Hex(plain);
  return (process.env.JOBS_PACK_PASSWORD_SHA256 || DEFAULT_PASSWORD_SHA256).toLowerCase();
}

/** Constant-time-ish comparison of two equal-purpose hex strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when the submitted password matches the configured pack password. */
export async function checkPackPassword(password: string): Promise<boolean> {
  if (!password) return false;
  const got = await sha256Hex(password);
  return safeEqual(got, await expectedHash());
}

// ── Passwordless share link ─────────────────────────────────────────────────
//
// A second, independent way in: `/download-jobs?access=<token>` unlocks the
// pack with no password prompt, then strips the token back out of the URL.
//
// Why it exists: the pack password is quoted to external hires, so rotating it
// disrupts all of them. A share link is single-purpose — it can be handed to
// one audience (the internal team, via the leave handover) and revoked on its
// own without anyone else noticing. It also lets a document that must stay
// credential-free still link straight through.
//
// Same storage discipline as the password: only the SHA-256 hash lives in the
// repo. Rotate or kill the link with JOBS_PACK_LINK_TOKEN (plaintext) or
// JOBS_PACK_LINK_TOKEN_SHA256 in Vercel — no code change needed.
//
// The grant is identical to a password sign-in: the same path-scoped,
// HMAC-signed cookie, which unlocks the pack and nothing else.

/** Query parameter carrying the share token. */
export const JOBS_PACK_ACCESS_PARAM = "access";

const DEFAULT_LINK_TOKEN_SHA256 =
  "1d38444a15da4898e5aef2862ce2a17b8be0e91a47e50041bda14d31e2b45f53";

async function expectedLinkHash(): Promise<string> {
  const plain = process.env.JOBS_PACK_LINK_TOKEN;
  if (plain) return sha256Hex(plain.trim());
  return (process.env.JOBS_PACK_LINK_TOKEN_SHA256 || DEFAULT_LINK_TOKEN_SHA256).toLowerCase();
}

/**
 * True when the `?access=` value is the configured share token.
 *
 * Trimmed before hashing: a token pasted out of a printed handover or a chat
 * message routinely arrives with a trailing space or newline, and a silently
 * dead link is the worst failure mode for a document nobody can debug.
 */
export async function checkPackLinkToken(token: string | undefined | null): Promise<boolean> {
  const t = token?.trim();
  if (!t) return false;
  return safeEqual(await sha256Hex(t), await expectedLinkHash());
}

/** HMAC secret for the access cookie — the same server secret used elsewhere. */
function packSecret(): string {
  return process.env.SUPABASE_SECRET_KEY || process.env.JOBS_PACK_SECRET || "";
}

/** Issue a signed access token for the pack (empty string if unconfigured). */
export async function issuePackToken(): Promise<string> {
  const secret = packSecret();
  if (!secret) return "";
  return signSession(SUBJECT, secret, JOBS_PACK_TTL_MS);
}

/** True when the cookie token is a valid, unexpired pack grant. */
export async function verifyPackToken(token: string | undefined): Promise<boolean> {
  const secret = packSecret();
  if (!secret || !token) return false;
  const subject = await verifySession(token, secret);
  return subject === SUBJECT;
}
