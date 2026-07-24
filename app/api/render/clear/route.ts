import { NextRequest, NextResponse } from "next/server";
import { supabase, getJob } from "@/lib/db";
import { BUCKET } from "@/lib/supabase";

export const runtime = "nodejs";

// Clears a job's renders (rows + storage) ahead of a regenerate. The regenerate
// flow ALWAYS re-optimizes the prompt next (✨ generate-brief) before submitting
// — replacing results means rethinking them, not replaying them.
export async function POST(req: NextRequest) {
  let body: { jobId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const jobId = Number(body.jobId);
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: `Job ${jobId} not found` }, { status: 404 });

  const { data: rows } = await supabase.from("renders").select("id, result_url").eq("job_id", jobId);
  const keys: string[] = [];
  const marker = `/public/${BUCKET}/`;
  for (const r of rows ?? []) {
    const u = r.result_url as string | null;
    if (!u) continue;
    const i = u.indexOf(marker);
    if (i !== -1) keys.push(u.slice(i + marker.length));
  }
  await supabase.from("renders").delete().eq("job_id", jobId);
  if (keys.length) await supabase.storage.from(BUCKET).remove(keys);

  // Re-roll the job so it doesn't read "Ready" with zero results.
  const { data: b } = await supabase.from("briefs").select("id").eq("job_id", jobId).limit(1).maybeSingle();
  await supabase
    .from("jobs")
    .update({ status: b ? "briefed" : "draft", updated_at: new Date().toISOString() })
    .eq("id", jobId);

  return NextResponse.json({ jobId, cleared: (rows ?? []).length });
}
