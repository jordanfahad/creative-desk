import { supabase, BUCKET } from "./supabase";

// Public URL for an object in the bucket (bucket is public).
const PUBLIC_BASE = `${process.env.SUPABASE_URL || ""}/storage/v1/object/public/${BUCKET}`;

export function publicUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path; // already a full URL
  return `${PUBLIC_BASE}/${path.replace(/^\/+/, "")}`;
}

// Upload a buffer to the bucket; returns the public URL. `path` is the object
// key, e.g. "assets/abc.jpg" or "renders/12-0-gmb.jpg".
export async function uploadBuffer(path: string, data: Buffer, contentType: string): Promise<string> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, data, { contentType, upsert: true });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return publicUrl(path);
}
