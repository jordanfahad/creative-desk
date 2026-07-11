import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { supabase, getJob } from "@/lib/db";
import { assembleContext, briefSystemPrompt, BriefSchema, type Brief } from "@/lib/context";

export const runtime = "nodejs";

// The brief route (OpenAI). Turns a job + re-injected brand context into a
// structured creative brief (static or dynamic). FIRES NO RENDERS. Returns the
// brief plus an estimated credit cost. The human reviews/edits, then sets the
// job to 'approved' before any render goes out.

// One-line model swap. gpt-4o supports JSON-schema structured outputs and is
// broadly available on project keys. Change to another OpenAI model as desired.
const MODEL = "gpt-4o";

// TODO: placeholder credit costs. Set real numbers once you see your fal
// plan's per-model cost (see README "Before this renders for real").
const CREDIT_COST = {
  static_still: 1, // per generated still (text2image / soul)
  dynamic_clip: 4, // per generated clip  (image2video / dop)
};

function estimateCredits(brief: Brief): number {
  if (brief.mode === "static") return brief.shots.length * CREDIT_COST.static_still;
  return brief.shots.length * CREDIT_COST.dynamic_clip;
}

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not set in .env.local" },
      { status: 500 },
    );
  }

  let body: { jobId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const jobId = Number(body.jobId);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: `Job ${jobId} not found` }, { status: 404 });
  }

  const { block, assets, inspiration } = await assembleContext(job);

  const directorBrief = (job.brief_doc_text ?? "").trim();
  const system = briefSystemPrompt(job, block, directorBrief, inspiration);

  // Attach the actual images so the model SEES what it's writing prompts for:
  // the user's source photos first, then the inspiration references, in order.
  const sourceImages = assets.filter((a) => a.media !== "video").slice(0, 4);
  const attachedNote =
    sourceImages.length || inspiration.length
      ? `Attached images, in order: ${[
          sourceImages.length ? `${sourceImages.length} source photo(s) [${sourceImages.map((a) => `#${a.id}`).join(", ")}]` : "",
          inspiration.length ? `${inspiration.length} inspiration reference(s) [${inspiration.map((a) => `#${a.id}`).join(", ")}]` : "",
        ]
          .filter(Boolean)
          .join(", then ")}.`
      : "";

  const userMsg = [
    `Job: ${job.title}`,
    job.goal ? `Goal: ${job.goal}` : "",
    job.brief_notes
      ? `Human direction (turn THIS into great prompts): ${job.brief_notes}`
      : "No direction given — infer a strong, on-brand idea from the brand context.",
    assets.length
      ? `Source photo/clip ids to ${job.intent === "optimize" ? "enhance" : "reference"}: ${assets.map((a) => a.id).join(", ")}`
      : "No source assets — text-to-image (source_asset_id = null).",
    attachedNote,
    "",
    "Write the production-grade prompt(s) now, as the structured brief.",
  ]
    .filter(Boolean)
    .join("\n");

  // Vision content: text first, then source photos, then references (order
  // matches attachedNote). detail:"low" — style/mood reading needs no zoom.
  const imageParts = [...sourceImages, ...inspiration].map((a) => ({
    type: "image_url" as const,
    image_url: { url: a.local_path, detail: "low" as const },
  }));
  const userContent =
    imageParts.length > 0
      ? [{ type: "text" as const, text: userMsg }, ...imageParts]
      : userMsg;

  const client = new OpenAI();

  let brief: Brief;
  try {
    // OpenAI structured outputs: chat.completions.parse + zodResponseFormat
    // constrains the response to BriefSchema; the validated object lands on
    // message.parsed. system goes in a system message (no top-level system).
    const completion = await client.beta.chat.completions.parse({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      response_format: zodResponseFormat(BriefSchema, "creative_brief"),
    });

    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) {
      const refusal = completion.choices[0]?.message.refusal;
      return NextResponse.json(
        { error: "Model did not return a parseable brief", refusal },
        { status: 502 },
      );
    }
    brief = parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `OpenAI request failed: ${message}` }, { status: 502 });
  }

  const creditEstimate = estimateCredits(brief);

  // Persist the brief and advance the job to 'briefed'.
  const { data: inserted } = await supabase
    .from("briefs")
    .insert({ job_id: jobId, content: JSON.stringify(brief), credit_estimate: creditEstimate, model: MODEL })
    .select("id")
    .single();
  await supabase
    .from("jobs")
    .update({ status: "briefed", updated_at: new Date().toISOString() })
    .eq("id", jobId);

  return NextResponse.json({
    briefId: inserted?.id ?? null,
    jobId,
    brief,
    creditEstimate,
    note: "Brief ready. Review/edit, then Generate.",
  });
}
