import { supabase, BUCKET } from "./supabase";

// Marketing creatives (renders, source assets, the logo) live in the PUBLIC
// bucket — they're meant to be downloaded and posted. Confidential documents
// (CEO/creative guideline PDFs, director brief PDFs) live in a PRIVATE bucket
// and are only ever served via short-lived signed URLs.
export const PRIVATE_BUCKET = process.env.SUPABASE_PRIVATE_BUCKET || "creative-desk-private";

// Public URL for an object in the public bucket.
const PUBLIC_BASE = `${process.env.SUPABASE_URL || ""}/storage/v1/object/public/${BUCKET}`;

export function publicUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path; // already a full URL
  return `${PUBLIC_BASE}/${path.replace(/^\/+/, "")}`;
}

// Upload a buffer to the public bucket; returns the public URL. `path` is the
// object key, e.g. "assets/abc.jpg" or "renders/12-0-gmb.jpg".
export async function uploadBuffer(path: string, data: Buffer, contentType: string): Promise<string> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, data, { contentType, upsert: true });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return publicUrl(path);
}

// Upload a confidential document to the PRIVATE bucket; returns the storage KEY
// (not a URL) to persist. Serve it later only via resolveDocUrl().
export async function uploadPrivate(key: string, data: Buffer, contentType: string): Promise<string> {
  const { error } = await supabase.storage
    .from(PRIVATE_BUCKET)
    .upload(key, data, { contentType, upsert: true });
  if (error) throw new Error(`private upload failed: ${error.message}`);
  return key;
}

// Resolve a stored document reference to a usable URL. New refs are private
// storage keys → a short-lived signed URL. Legacy refs are full public URLs →
// returned as-is. Returns null if it can't be resolved (caller hides the link).
export async function resolveDocUrl(stored: string | null, expiresIn = 3600): Promise<string | null> {
  if (!stored) return null;
  if (/^https?:\/\//.test(stored)) return stored;
  const { data, error } = await supabase.storage.from(PRIVATE_BUCKET).createSignedUrl(stored, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
