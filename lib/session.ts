// Signed login-session tokens. Edge-safe by design (WebCrypto + atob/btoa
// only) so the SAME code verifies cookies in middleware (edge runtime) and
// issues them in the auth route (node). Token = `${payload}.${sig}` where
// payload = base64url("email|expiryMs") and sig = HMAC-SHA256(payload).
// The HMAC secret is SUPABASE_SECRET_KEY — already in the environment,
// server-only, and rotating it simply signs everyone out.

export const SESSION_COOKIE = "cd_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(email: string, secret: string, ttlMs = SESSION_TTL_MS): Promise<string> {
  const payload = b64url(enc.encode(`${email}|${Date.now() + ttlMs}`));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

/** Returns the signed-in email, or null for a missing/tampered/expired token. */
export async function verifySession(token: string | undefined, secret: string): Promise<string | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const sig = b64urlDecode(token.slice(dot + 1));
  if (!sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig as BufferSource, enc.encode(payload));
  if (!ok) return null;
  const decodedBytes = b64urlDecode(payload);
  if (!decodedBytes) return null;
  const decoded = new TextDecoder().decode(decodedBytes);
  const i = decoded.lastIndexOf("|");
  if (i < 1) return null;
  const email = decoded.slice(0, i);
  const exp = Number(decoded.slice(i + 1));
  if (!email || !Number.isFinite(exp) || Date.now() > exp) return null;
  return email;
}
