import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { supabase, getJob } from "@/lib/db";
import { assembleContext, BriefSchema, type Brief } from "@/lib/context";

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

  const { block, assets } = await assembleContext(job);

  const directorBrief = (job.brief_doc_text ?? "").trim();

  const system = [
    "You are the creative director for a dental clinic's content desk.",
    "Plan a piece for the fal.ai render pipeline (FLUX for stills, Kling for clips) using ONLY the brand context below.",
    "",
    block,
    "",
    ...(directorBrief
      ? [
          "# Creative director brief (uploaded PDF) — PRIMARY DIRECTION",
          "Treat the following as the lead brief; the shots must realize it while",
          "staying within the brand guardrails above.",
          directorBrief.slice(0, 12000),
          "",
        ]
      : []),
    "# How the renderer works (do not oversell)",
    "The renderer returns single clips or single stills — NOT finished ads. So your",
    "brief outputs a list of shots PLUS assembly_instructions describing how the",
    "human stitches them in their editor (music, burned captions, logo sting).",
    "",
    "# Mode",
    job.mode === "static"
      ? "STATIC: still images for Google Business Profile / trust. duration_seconds = 0, motion = \"\"."
      : "DYNAMIC: short awareness video. Each shot is one clip with motion and a duration.",
    "",
    "# Rules",
    "- Respect every hard guardrail above. Never imply a medical outcome or claim.",
    "- Reference selected source assets by their id in source_asset_id when a shot is built from one.",
    "- Keep prompts concrete and on-brand.",
  ].join("\n");

  const userMsg = [
    `Job: ${job.title}`,
    job.goal ? `Goal: ${job.goal}` : "",
    job.brief_notes ? `Human direction: ${job.brief_notes}` : "",
    assets.length
      ? `Available source asset ids: ${assets.map((a) => a.id).join(", ")}`
      : "No source assets selected — use text-to-image (source_asset_id = null).",
    "",
    "Produce the structured creative brief.",
  ]
    .filter(Boolean)
    .join("\n");

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
        { role: "user", content: userMsg },
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
