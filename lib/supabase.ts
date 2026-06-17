import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side Supabase admin client (secret key → bypasses RLS). Backs both the
// database and file storage, locally and on Vercel.

const url = process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_SECRET_KEY || "";

export const BUCKET = process.env.SUPABASE_BUCKET || "creative-desk";

declare global {
  // eslint-disable-next-line no-var
  var __supabase: SupabaseClient | undefined;
}

function make(): SupabaseClient {
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY are not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const supabase: SupabaseClient = globalThis.__supabase ?? make();
if (process.env.NODE_ENV !== "production") globalThis.__supabase = supabase;
