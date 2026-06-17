import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, resolve, sep } from "node:path";

export const runtime = "nodejs";

// Serves files from ./storage so the dashboard can display uploaded assets and
// a tunnel can expose them to Higgsfield. Kept outside /public so secrets/data
// never get bundled; this route enforces a no-traversal boundary.

const STORAGE_ROOT = resolve(process.env.CREATIVE_DESK_STORAGE || "./storage");

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const rel = normalize(path.join("/")).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = resolve(join(STORAGE_ROOT, rel));

  // Containment check — abs must live under STORAGE_ROOT.
  if (abs !== STORAGE_ROOT && !abs.startsWith(STORAGE_ROOT + sep)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const info = await stat(abs);
    if (!info.isFile()) return new NextResponse("Not found", { status: 404 });
    const data = await readFile(abs);
    const ext = abs.slice(abs.lastIndexOf(".")).toLowerCase();
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
