import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side Supabase admin client (secret key → bypasses RLS). Backs the
// database and file storage, locally and on Vercel. Lazily initialized so a
// build with missing env vars never crashes (it only throws on first use).

export const BUCKET = process.env.SUPABASE_BUCKET || "creative-desk";

let _client: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY are not set");
  _client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _client;
}

// Proxy so `supabase.from(...)` / `supabase.storage` work, but the client is
// only created on first property access (request time, never at build time).
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = client() as unknown as Record<string | symbol, unknown>;
    const v = c[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
});
