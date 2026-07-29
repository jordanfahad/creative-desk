import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { supabase } from "@/lib/db";
import { BUCKET } from "@/lib/supabase";
import { JOBS_PACK_COOKIE, verifyPackToken } from "@/lib/jobsPack";
import { designerBrief } from "@/lib/designerBriefs";

export const runtime = "nodejs";

// Signed direct-to-storage upload for an EXTERNAL designer delivering work.
// Gated by the Jobs Pack token only — this never touches the internal session,
// and it can only ever write inside that designer's own delivery folder.

const MAX_BYTES = 500 * 1024 * 1024; // finished video masters are large

function contentTypeOf(name: string): string | null {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return (
    {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
      ".gif": "image/gif", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
      ".m4v": "video/x-m4v", ".pdf": "application/pdf", ".zip": "application/zip",
      ".aep": "application/octet-stream", ".prproj": "application/octet-stream",
      ".psd": "image/vnd.adobe.photoshop", ".ai": "application/postscript",
      ".mp3": "audio/mpeg", ".wav": "audio/wav", ".otf": "font/otf", ".ttf": "font/ttf",
    }[ext] ?? null
  );
}

// Keep the stored name recognisable but safe, and never let it escape the folder.
function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").replace(/_{2,}/g, "_").slice(-120);
}

export async function POST(req: NextRequest) {
  const token = (await cookies()).get(JOBS_PACK_COOKIE)?.value;
  if (!(await verifyPackToken(token))) {
    return NextResponse.json({ error: "Not signed in to the jobs pack." }, { status: 401 });
  }

  let body: { slug?: string; filename?: string; size?: number; folder?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const brief = designerBrief((body.slug ?? "").toString());
  if (!brief) return NextResponse.json({ error: "Unknown designer." }, { status: 404 });

  const filename = (body.filename ?? "").toString();
  const size = Number(body.size ?? 0);
  if (!filename) return NextResponse.json({ error: "filename is required" }, { status: 400 });
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)}MB).` }, { status: 400 });
  }
  const contentType = contentTypeOf(filename);
  if (!contentType) return NextResponse.json({ error: `Unsupported file type: ${filename}` }, { status: 400 });
  // SVG is never accepted — a stored SVG served from the public bucket is XSS.
  if (/\.svg$/i.test(filename)) return NextResponse.json({ error: "SVG is not accepted." }, { status: 400 });

  // Folder comes from the brief's own lane list — no caller-supplied paths.
  const folders = [
    ...brief.lanes.map((l) => `Lane-${l.key}`),
    "_source",
  ];
  const folder = folders.includes((body.folder ?? "").toString()) ? (body.folder as string) : "_unsorted";

  const key = `${brief.uploadPrefix}/${folder}/${randomUUID().slice(0, 8)}-${safeName(filename)}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(key);
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not create an upload URL." }, { status: 500 });
  }
  return NextResponse.json({ signedUrl: data.signedUrl, path: key, contentType });
}
