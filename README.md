# Creative Desk — The Spine (local-first)

An internal creative production desk for the dental clinics. Stores brand
context once, re-injects it into every generation, and tracks every render job
from brief → approval → render → result. Brief = OpenAI; images + video = fal.ai.

**Runs entirely on your laptop** — SQLite + local files instead of Supabase.

## The flow (two modes, one spine)

```
Create job (static = GMB trust stills | dynamic = awareness video)
  → pick source assets  (+ optional creative-director brief PDF)
  → POST /api/generate-brief     (OpenAI plans; NO render)
  → review/edit brief
  → set job status = 'approved'  (the gate)
  → POST /api/render/submit      (fal generates: stills now, video queued)
  → POST /api/render/poll        (fills in video results)
  → gallery of finished clips/stills + captions + assembly sheet
```

## Two truths baked in

- **No model training.** "Give the model the guidelines once" = store once
  (`brand_kit` + `guidelines`), re-inject every time. `lib/context.ts` is that
  mechanism.
- **The renderer returns single clips/stills, not finished ads.** The brief
  outputs shots **plus** assembly instructions. The final cut (music, burned
  captions, logo sting) happens in your editor.

## What's here (the spine)

| File | Purpose |
|---|---|
| `db/schema.sql` | The data model & context store (SQLite). |
| `lib/db.ts` | Opens SQLite, applies the schema, typed helpers. |
| `lib/context.ts` | Assembles brand kit + active guidelines + selected assets into the injected context block. Also the shared `BriefSchema`. |
| `app/api/generate-brief/route.ts` | OpenAI route → structured brief. No renders. |
| `lib/fal.ts` | fal.ai client — FLUX stills (REST) + image-to-video (SDK queue). |
| `app/api/render/submit/route.ts` | Fires renders on fal — only for `approved` jobs. |
| `app/api/render/poll/route.ts` | Polls fal video queue, stores result URLs. |
| `scripts/seed.mjs` | Seeds a sample brand kit, guideline, asset, and two jobs. |

## Run it

```bash
npm install
cp .env.example .env.local        # paste your OPENAI_API_KEY + FAL_KEY
npm run db:seed                   # sample brand kit + jobs
npm run dev                       # http://localhost:3017
```

Then walk the flow in the browser: **Brand kit → Assets → New job →
Generate brief → Approve → Submit** (→ **Poll** for video).

## Environment variables (`.env.local`)

```
OPENAI_API_KEY=             # brief generation (gpt-4o by default)
FAL_KEY=<id>:<secret>       # stills (FLUX) + video (image-to-video)
# FAL_IMAGE_MODEL=fal-ai/flux/schnell                              (optional)
# FAL_VIDEO_MODEL=fal-ai/ltx-video-13b-distilled/image-to-video   (optional)
CREATIVE_DESK_DB=./data/creative-desk.db
CREATIVE_DESK_STORAGE=./storage
```

## Generation (all fal.ai)

- **Static stills → FLUX (synchronous).** Submit generates the image, downloads
  it into `./storage/renders`, and marks the render `completed` on the spot
  (job → `done`, no poll). Default model `fal-ai/flux/dev`. **Live-verified.**
- **Dynamic video → image-to-video (fal queue).** Submit uploads the source
  still to fal storage (or generates one with FLUX), enqueues the clip, and
  stores the request id. **Poll** checks the queue and downloads the finished
  `.mp4` into `./storage/renders`. Default model
  `fal-ai/kling-video/v1.6/standard/image-to-video` (~$0.056/s, ~6 min/clip).
  SDK pieces verified; fire a clip to test end to end (it costs fal credits).
- No tunnel needed — fal hosts source images via `fal.storage.upload`.
- Note: FLUX (and most models) garble text rendered *inside* images — keep the
  brand name in the caption, not painted on the wall.

## Dashboard (built)

Full UI on top of the spine — `npm run dev`, then:

| Page | What it does |
|---|---|
| `/` | Jobs list with status badges |
| `/brand` | Brand kit + guidelines (type or **upload PDF**, tagged Creative/CEO; CEO weighted highest) — the re-injected context |
| `/assets` | Upload clinic/doctor shots, tag kind + quality |
| `/jobs/new` | Job builder — mode, goal, direction, pick source assets |
| `/jobs/[id]` | Brief review/edit, the **approval gate**, submit + poll, result gallery + assembly sheet |

Mutations use Next server actions (`lib/actions.ts`); assets are served from
`./storage` by `app/api/storage/[...path]`. The three pipeline operations
(generate-brief, submit, poll) call the API routes from `app/jobs/[id]/JobActions.tsx`.

## Remaining

- **Live video test** — the image-to-video path is implemented and its fal
  pieces verified, but no paid clip has been generated yet. Run one dynamic job
  to confirm the queue → poll → gallery cycle end to end.
- Real per-render `CREDIT_COST` numbers for the estimate.
