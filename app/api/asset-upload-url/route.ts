import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/db";
import { BUCKET } from "@/lib/supabase";

export const runtime = "nodejs";

// Signed direct-to-storage upload. The browser uploads the file straight to
// Supabase Storage (bypassing the Server Action body cap, ~4.5MB on Vercel),
// then records the asset via attachJobAssets. Session-gated by middleware.

const MAX_BYTES = 60 * 1024 * 1024;

function mediaOfName(name: string): "image" | "video" | "audio" | null {
  if (/\.(png|jpe?g|webp|gif)$/i.test(name)) return "image";
  if (/\.(mp4|webm|mov|m4v)$/i.test(name)) return "video";
  if (/\.(mp3|m4a|aac|wav|ogg)$/i.test(name)) return "audio";
  return null;
}

export async function POST(req: NextRequest) {
  let body: { jobId?: number; filename?: string; size?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const jobId = Number(body.jobId);
  if (!Number.isFinite(jobId)) return NextResponse.json({ error: "jobId is required" }, { status: 400 });

  const filename = String(body.filename ?? "").trim();
  if (!mediaOfName(filename)) {
    return NextResponse.json({ error: "Only image, video or audio files are supported." }, { status: 400 });
  }
  if (body.size != null && Number(body.size) > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 60 MB)." }, { status: 413 });
  }

  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload";
  const path = `assets/${randomUUID().slice(0, 8)}-${safe}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: "Could not start the upload." }, { status: 502 });
  }
  return NextResponse.json({ path: data.path, token: data.token, signedUrl: data.signedUrl });
}