# Creative Desk — world-class roadmap

From the multi-agent audit (72 findings, 33 confirmed). Goal: brilliant flow for
**optimize-existing** AND **create-new**, across **images AND videos**, fanned out
to **GMB / Paid / Organic** channels from one AI master.

## Product model
- **intent**: `optimize` (fix an uploaded creative) | `create` (from a prompt)
- **media**: `image` | `video`
- **channels**: multi-select, grouped GMB / Paid / Organic → one master → N deliverables (free crops)

## Backlog (status)

### P0 — correctness
- [x] Harden `finishImage` (clamp logo, wrap toBuffer)
- [x] Guard all `JSON.parse(asset_ids)`; `safeParse` stored briefs
- [x] Persist static render failures; correct the `done` vs `partial`/`failed` rollup
- [x] Mark terminally-failed video renders `failed` (no infinite poll)
- [x] Cap `shots` (≤20) + per-file size; gate `uploadAsset` to image/video
- [ ] (skipped) shared-secret auth — local single-user tool

### P1 — flow
- [x] **intent (Optimize/Create) + media (Image/Video) first-class** on /jobs/new
- [x] Collapse `mode`/`image_mode`/`combine` duality → derive from (intent, media, assets)
- [x] Consolidate settings onto the job page; /jobs/new = title + intent + media
- [x] Auto-poll + human progress/empty/error states
- [ ] Per-photo edit instruction (today: one shared direction per job)
- [ ] "Add from library" picker (today: upload on the job)
- [ ] Retry button on failed tiles

### P2 — channels (headline)
- [x] Multi-select channels grouped GMB / Paid / Organic (job `platforms[]`)
- [x] Generate AI master once → fan out free crops per channel
- [x] Expand + group PLATFORMS taxonomy (family, ratio, w/h, maxDuration)
- [x] Results grouped + labelled by channel

### P3 — video (built; not yet live-tested — needs a paid clip)
- [x] Allow video at ingest (uploader, `assets.media`, `<video>` thumbs)
- [x] `finishVideo` (ffmpeg crop/scale + logo overlay)
- [x] Thread duration into video generation; square master → per-channel crop
- [x] Video-optimize: passthrough (no AI, synchronous ffmpeg)
- [ ] Video-to-video AI enhance (ai_enhance) — deferred

### P4 — polish
- [x] Replace "Higgsfield" → fal.ai in the brief prompt + copy
- [x] Humanize home/nav statuses (Image/Video, Optimize/Create)
- [ ] Surface credit estimate before Generate; dedupe cost tables
- [ ] Versioned migration runner; drop dead columns; render assembly sheet
