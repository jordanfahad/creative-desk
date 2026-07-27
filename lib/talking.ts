// "Talking doctor" — turn a REAL team portrait plus a scripted line into a clip
// of that person delivering it (lip-sync, head motion, natural gestures).
//
// CONSENT IS NON-NEGOTIABLE. This synthesises a real, identifiable, licensed
// clinician appearing to say words they never recorded. Every entry point here
// requires the asset to be flagged consented (assets.consent = 1), which the
// account owner sets per person in Brand kit → Team after obtaining written
// sign-off. There is deliberately no way to bypass it from a render path.

import { supabase, type Asset } from "./db";
import { synthVoice } from "./voice";
import { uploadImageToFal, enqueueModel, queueResult, videoStatus } from "./fal";
import { MODELS, talkingInput } from "./models";

export class ConsentError extends Error {}

/** The consented team members whose photo may be animated to speak. */
export async function listConsentedSpeakers(projectId: number): Promise<Asset[]> {
  const { data } = await supabase
    .from("assets")
    .select("*")
    .eq("project_id", projectId)
    .eq("kind", "character")
    .eq("media", "image")
    .eq("consent", 1)
    .order("id", { ascending: false });
  return (data as Asset[]) ?? [];
}

/** Re-check consent at render time against the DB — never trust a passed-in flag. */
export async function assertSpeakerConsent(assetId: number): Promise<Asset> {
  const { data } = await supabase.from("assets").select("*").eq("id", assetId).maybeSingle();
  const a = data as Asset | null;
  if (!a) throw new ConsentError("That team member no longer exists.");
  if (a.kind !== "character") throw new ConsentError("Only a team member can be given a speaking line.");
  if (a.consent !== 1) {
    throw new ConsentError(
      `${a.filename} has not been marked as consenting to speak. Get their written sign-off, then tick "Mark consented to speak" in Brand kit → Team.`,
    );
  }
  return a;
}

/**
 * Render `script` as `speaker` saying it. Returns the clip URL (fal-hosted).
 * Throws ConsentError if the person has not consented.
 */
export async function renderTalkingClip(opts: {
  assetId: number;
  script: string;
  voice?: string;
  resolution?: string;
  /** how long to wait for the model before giving up (ms) */
  timeoutMs?: number;
}): Promise<{ url: string; speaker: string }> {
  const line = (opts.script ?? "").trim();
  if (!line) throw new Error("No script line to speak.");
  const speaker = await assertSpeakerConsent(opts.assetId);

  // 1 · voice the line, 2 · host it so the model can fetch it
  const mp3 = await synthVoice(line, opts.voice);
  const audioUrl = await uploadImageToFal(mp3, "audio/mpeg");

  // 3 · animate the real portrait to deliver it
  const spec = MODELS.talking;
  const sub = await enqueueModel(
    spec.id,
    talkingInput({ imageUrl: speaker.local_path, audioUrl, resolution: opts.resolution }),
  );

  const deadline = Date.now() + (opts.timeoutMs ?? 240_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 8000));
    const st = await videoStatus(spec.id, sub.requestId);
    if (st === "completed") {
      const url = (await queueResult(spec.id, sub.requestId)).video;
      if (!url) throw new Error("The talking model returned no video.");
      return { url, speaker: speaker.filename };
    }
    if (st === "failed") throw new Error("The talking model failed to render.");
  }
  throw new Error("Timed out waiting for the talking clip.");
}
