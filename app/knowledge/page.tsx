import Link from "next/link";

export const metadata = { title: "Knowledge · Creative Desk" };

const TOC = [
  ["what", "What Creative Desk does"],
  ["quickstart", "Quick start (5 steps)"],
  ["concepts", "Key concepts"],
  ["howto", "Step-by-step guides"],
  ["tips", "Tips for the best results"],
  ["faq", "FAQ"],
] as const;

export default function KnowledgePage() {
  return (
    <main>
      <h1>Knowledge & how-to</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Everything you need to get polished, on-brand creatives out of Creative Desk — what each
        feature does, how to use it, and answers to common questions.
      </p>

      <div className="card">
        <strong className="small">On this page</strong>
        <div className="row" style={{ gap: 10, marginTop: 8 }}>
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="small">
              {label}
            </a>
          ))}
        </div>
      </div>

      {/* ── WHAT ── */}
      <h2 id="what">What Creative Desk does</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Creative Desk turns your brand context into <strong>finished, on-brand marketing
          creatives</strong> — sized for every channel — in one pass. You do two kinds of work:
        </p>
        <ul>
          <li>
            <strong>Optimize</strong> an existing photo or video — fix the lighting, clean it up, and
            lift it to your brand look.
          </li>
          <li>
            <strong>Create</strong> something brand-new from a description — a still or a short video.
          </li>
        </ul>
        <p>
          For either, you generate <strong>one master</strong>, and Creative Desk automatically crops
          and brands it for <strong>every channel you tick</strong> (Google Business Profile, paid
          social, organic social). The AI generation happens once; the per-channel re-crops are free.
        </p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Brief writing uses OpenAI (GPT-4o). Image and video generation use fal.ai (FLUX for stills,
          FLUX Kontext for photo edits, Kling for video). Your brand context is re-injected into every
          prompt automatically.
        </p>
      </div>

      {/* ── QUICK START ── */}
      <h2 id="quickstart">Quick start (5 steps)</h2>
      <div className="card">
        <ol style={{ marginTop: 0 }}>
          <li>
            <strong>Set up the brand kit</strong> (once per project). On{" "}
            <Link href="/brand">Brand kit</Link>, add your palette, voice, guardrails, upload your
            logo, and add your guidelines / CEO directives.
          </li>
          <li>
            <strong>Start a job</strong> on <Link href="/jobs/new">New job</Link> — pick Optimize or
            Create, Image or Video, and give it a name.
          </li>
          <li>
            <strong>Add your direction.</strong> Upload the photo/clip to optimize, or type what you
            want to create. Pick the channels and a visual style.
          </li>
          <li>
            <strong>✨ Optimize prompt with AI.</strong> This turns your direction + brand context
            into a production-grade prompt. Review or tweak it.
          </li>
          <li>
            <strong>★ Generate.</strong> You get one branded deliverable per channel, ready to
            download.
          </li>
        </ol>
      </div>

      {/* ── CONCEPTS ── */}
      <h2 id="concepts">Key concepts</h2>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Projects</h3>
        <p style={{ marginBottom: 0 }}>
          Each <strong>project</strong> is a separate brand with its own logo, palette, voice,
          guidelines, assets and jobs (Dental Nation, Balenciaga, …). Switch projects from the dropdown
          in the top bar, or add a new one on <Link href="/projects">Projects</Link>. Set the brand kit
          up once per project.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Brand kit & the logo</h3>
        <p>
          The brand kit is the context every prompt is built from: clinic/brand name, tagline, voice,
          color palette (hex), fonts, hard guardrails (things to never imply), and boilerplate. It is
          stored once and re-injected automatically.
        </p>
        <p style={{ marginBottom: 0 }}>
          <strong>Logos</strong> (transparent PNGs) are composited onto a corner of every finished
          creative — never AI-drawn, so they stay crisp. Add multiple <strong>variations</strong> per
          project (primary, a white/reversed version for dark backgrounds, an icon-only mark…) on{" "}
          <Link href="/brand">Brand kit</Link>; one is the default, and you pick which variation and
          which corner per job.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Guidelines & CEO directives</h3>
        <p style={{ marginBottom: 0 }}>
          Add written guidance the AI must follow — typed notes or uploaded documents. They are
          grouped by source: <strong>CEO directives</strong> are treated as highest priority and
          outrank creative-team guidelines if they ever conflict. Toggle a guideline off to retire it
          without deleting. Only <em>active</em> guidelines are injected into prompts.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Prompt optimization (✨)</h3>
        <p style={{ marginBottom: 0 }}>
          This is the most important step. Your short direction is sent to GPT-4o along with the full
          brand context (palette, voice, guidelines, CEO directives), which writes a complete,
          photographic, on-brand prompt — subject, setting, composition, lighting, lens, color grade,
          mood. <strong>Always click ✨ Optimize before Generate</strong> — it is the difference
          between a generic image and an on-brand one. You can edit the optimized prompt before
          generating.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Style presets & negative prompts</h3>
        <p>
          Pick a <strong>style</strong> (Editorial, Warm lifestyle, Clinical-clean, Cinematic, Bright
          &amp; friendly, or Auto) in the job settings to steer the look. Re-optimize after changing
          it.
        </p>
        <p style={{ marginBottom: 0 }}>
          The optimizer also builds an <strong>avoid-list</strong> (deformed hands, fake-white teeth,
          plastic skin, on-image text, clutter…). For video this is passed to the model as a real
          negative prompt; for images the avoidances are written into the prompt itself.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Channels</h3>
        <p style={{ marginBottom: 0 }}>
          Tick the channels you want under three groups — <strong>GMB</strong>, <strong>Paid
          social</strong>, <strong>Organic social</strong>. Each delivers the creative at its exact
          dimensions (e.g. 1080×1080 square, 1080×1920 story/reel, 1.91:1 link). Generating one master
          and re-cropping per channel is what makes this fast and cheap.
        </p>
      </div>

      {/* ── HOW TO ── */}
      <h2 id="howto">Step-by-step guides</h2>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Optimize an existing photo</h3>
        <ol style={{ marginBottom: 0 }}>
          <li>New job → <strong>Optimize</strong> + <strong>Image</strong> → name it.</li>
          <li>Upload your photo(s) under “Your photos”.</li>
          <li>Type what to fix (e.g. “brighten, declutter, warmer tone”) — or leave it blank for a clean enhance.</li>
          <li>Pick channels, a style, and the logo corner. Save.</li>
          <li>✨ Optimize prompt → review → ★ Generate.</li>
        </ol>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Create a new image from a description</h3>
        <ol style={{ marginBottom: 0 }}>
          <li>New job → <strong>Create</strong> + <strong>Image</strong> → name it.</li>
          <li>Describe what you want (e.g. “calm reception that builds trust”).</li>
          <li>Pick channels + style. Save.</li>
          <li>✨ Optimize prompt — this plans 1–4 shots. Review/edit.</li>
          <li>★ Generate → one branded deliverable per channel, per shot.</li>
        </ol>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Make a short video</h3>
        <ol>
          <li>New job → Optimize <em>or</em> Create + <strong>Video</strong>.</li>
          <li>
            <strong>Optimize video</strong> just re-sizes &amp; brands a clip you upload (fast, no AI
            credits). <strong>Create video</strong> generates a new ~5s clip from your prompt (AI).
          </li>
          <li>✨ Optimize prompt → ★ Generate.</li>
          <li>
            AI video takes a few minutes — keep the job page open; it checks automatically and fans
            out to your channels when done.
          </li>
        </ol>
        <p className="small muted" style={{ marginBottom: 0 }}>
          AI clips are silent by design — add music/voiceover in your editor.
        </p>
      </div>

      {/* ── TIPS ── */}
      <h2 id="tips">Tips for the best results</h2>
      <div className="card">
        <ul style={{ margin: 0 }}>
          <li><strong>Always ✨ Optimize before Generate</strong> — that is where your brand &amp; CEO context is applied.</li>
          <li>Not happy with a result? Hit <strong>↻ Re-optimize</strong> (it varies) or edit the prompt text directly, then Generate.</li>
          <li>Switch the <strong>style preset</strong> and re-optimize to change the whole look fast.</li>
          <li>Keep guardrails specific (e.g. “never imply guaranteed results”) — the model honors them.</li>
          <li>Upload a real <strong>transparent-PNG logo</strong> for a clean corner stamp.</li>
          <li>Tick only the channels you need — every channel is a separate deliverable.</li>
        </ul>
      </div>

      {/* ── FAQ ── */}
      <h2 id="faq">FAQ</h2>
      <div className="card">
        {[
          ["Why does a result sometimes look generic or off-brand?", "Almost always because the prompt wasn’t optimized. Click ✨ Optimize prompt before Generate — that injects your palette, voice, guidelines and CEO directives. Generating straight from raw text skips all of that."],
          ["What’s the difference between Optimize and Create?", "Optimize edits a photo/clip you upload (keeps the real subject, improves it). Create makes brand-new imagery from a text description."],
          ["Does it cost money to generate?", "Yes — image/video generation uses fal.ai credits and prompt optimization uses OpenAI credits. The per-channel re-crops are free; only the master generation costs. The Generate card shows how many AI generations a job will run."],
          ["How do I add or change my logo?", "On the Brand kit page, upload a transparent PNG (or JPG/WebP). You can replace it anytime — no need to remove the old one first. It’s composited onto every creative; pick the corner per job."],
          ["How do guidelines and CEO input get used?", "Active guidelines are injected into every optimized prompt. CEO directives are weighted highest and override creative-team guidance on conflict."],
          ["Why is video slow?", "AI video (Kling) genuinely takes a few minutes to render. The page polls automatically — keep it open and the channels fill in when it’s ready. ‘Optimize video’ (resize only) is fast."],
          ["Can I edit the AI’s prompt before generating?", "Yes. After ✨ Optimize, the prompt is shown and editable (open ‘Edit prompt’). Tweak it, save, then Generate."],
          ["What are projects for?", "Each project is a separate brand (Dental Nation, Balenciaga, …) with its own logo, palette, guidelines, assets and jobs. Switch from the top-bar dropdown; add new ones on the Projects page. You can delete a project (and everything in it) from the Projects page."],
          ["Which channels/sizes are supported?", "GMB (square, landscape, cover), paid social (Meta feed/story/reel, link), and organic (IG feed/story/reel, FB, TikTok, YouTube short/thumbnail, Pinterest). Each exports at its exact dimensions."],
          ["Can I upload a guideline PDF on the website?", "PDF text extraction currently runs best from the local app. On the hosted site, paste the guideline text instead (Add guideline → text). Your existing brand PDFs are already loaded."],
        ].map(([q, a], i) => (
          <details key={i} style={{ borderTop: i ? "1px solid var(--border)" : undefined, padding: "12px 0" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>{q}</summary>
            <p className="small muted" style={{ margin: "8px 0 0" }}>{a}</p>
          </details>
        ))}
      </div>
    </main>
  );
}
