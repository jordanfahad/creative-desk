# Creative Desk — The Spine

An internal creative production desk for **Dental Nation**. Stores brand context
once, re-injects it into every generation, and tracks every render job from
brief → approval → render → result. Brief = OpenAI (gpt-4o); images + video =
fal.ai.

**Deployed on Vercel** at https://creative-desk.vercel.app, backed by
**Supabase** (Postgres for data, Storage for assets + renders).

## The flow (two modes, one spine)

```
Create job (static = GMB trust stills | dynamic = awareness video)
  → pick source assets  (+ optional creative-director brief PDF)
  → POST /api/generate-brief     (OpenAI gpt-4o plans; NO render)
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
| `lib/context.ts` | Assembles brand kit + active guidelines + selected assets into the injected context block. Also the shared `BriefSchema`. |
| `app/api/generate-brief/route.ts` | OpenAI (gpt-4o) route → structured brief. No renders. |
| `lib/fal.ts` | fal.ai client — FLUX + Kontext stills (REST) + Kling image-to-video (SDK queue). |
| `app/api/render/submit/route.ts` | Fires renders on fal — only for `approved` jobs. |
| `app/api/render/poll/route.ts` | Polls fal video queue, stores result URLs in Supabase Storage. |
| `db/schema.sql` | **Legacy** SQLite DDL — kept only for local-script reference; the live DB is Supabase Postgres. |
| `scripts/seed.mjs` | **Legacy** local seed script (SQLite). |

## Run it (local dev)

```bash
npm install
cp .env.example .env.local        # fill in the keys below
npm run dev                       # http://localhost:3017
```

Then walk the flow in the browser: **Brand kit → Assets → New job →
Generate brief → Approve → Submit** (→ **Poll** for video).

## Environment variables (`.env.local`)

```
OPENAI_API_KEY=                   # brief generation (gpt-4o)
FAL_KEY=<id>:<secret>             # stills (FLUX + Kontext) + video (Kling)
SUPABASE_URL=                     # your Supabase project URL
SUPABASE_SECRET_KEY=              # Supabase service-role / secret key (server-side)
SUPABASE_BUCKET=creative-desk             # public bucket (assets, finished renders)
SUPABASE_PRIVATE_BUCKET=creative-desk-private  # private bucket (uploads, source PDFs)

# Optional password gate — if BOTH are set, the app requires HTTP Basic auth.
# Leave unset for an open desk.
# APP_BASIC_USER=
# APP_BASIC_PASS=
```

> The local SQLite scripts (`db/schema.sql`, `scripts/seed.mjs`, the
> `CREATIVE_DESK_DB` / `CREATIVE_DESK_STORAGE` vars) are **legacy** and are not
> used by the live app — Supabase is the source of truth.

## Generation (all fal.ai)

- **Static stills → FLUX / Kontext.** Submit generates (or edits) the image,
  uploads it to the Supabase public bucket, and marks the render `completed` on
  the spot (job → `done`, no poll).
- **Dynamic video → Kling image-to-video (fal queue).** Submit uploads the
  source still to fal storage (or generates one with FLUX), enqueues the clip,
  and stores the request id. **Poll** checks the queue and stores the finished
  `.mp4` in Supabase Storage.
- No tunnel needed — fal hosts source images via `fal.storage.upload`.
- Note: FLUX (and most models) garble text rendered *inside* images — keep the
  brand name in the caption, not painted on the wall.

## Dashboard

Full UI on top of the spine:

| Page | What it does |
|---|---|
| `/` | Jobs list with status badges |
| `/brand` | Brand kit + guidelines (type or **upload PDF**, tagged Creative/CEO; CEO weighted highest) — the re-injected context |
| `/assets` | Upload clinic/doctor shots, tag kind + quality |
| `/jobs/new` | Job builder — mode, goal, direction, pick source assets |
| `/jobs/[id]` | Brief review/edit, the **approval gate**, submit + poll, result gallery + assembly sheet |

Mutations use Next server actions (`lib/actions.ts`); assets are served from
Supabase Storage. The three pipeline operations (generate-brief, submit, poll)
call the API routes from `app/jobs/[id]/JobActions.tsx`.
