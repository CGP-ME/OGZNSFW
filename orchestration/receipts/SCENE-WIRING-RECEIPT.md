# Receipt: M-20260817-004 (Scene Foundation End-to-End Wiring)

- Mission ID: M-20260817-004
- Date/time: 2026-08-17T07:00:00-07:00 / 2026-08-17T07:35:00-07:00 (machine local, UTC-7)
- Requester: Trey
- Assigned agent: Fable (Claude Code session, model claude-fable-5)
- Objective: Wire the multi-character scene foundation end-to-end: API routes
  (create/compile/generate/validate/publish), scene-builder web UI, honest
  provider/validator states. Deterministic doubles in tests only; no real
  image provider, no ComfyUI, no video, no git actions.
- Allowed scope: OGZNSFW repo (Q:/OpenClaw/workspace). API, UI, scene-layer
  glue, tests, this receipt.
- Forbidden actions: no installs, no real providers/keys, no ComfyUI, no
  video, no orchestration-file modification (this receipt is a new file), no
  stage/commit/push, no VPS.

## Files changed (modified)

1. apps/api/server.js - scene routes + reference-pack routes; createApp gains
   an optional imageValidator (default null -> honest 503 on validate).
2. apps/web/index.html - Scenes panel: per-character include/version/role/
   wardrobe/pose/reference inputs, setting/camera/lighting/spatial fields,
   scene list with status badges and lifecycle buttons, request preview pane.
3. apps/web/app.js - scene builder logic, lifecycle actions, honest error
   display; one UI bug found during live verification (action messages were
   wiped by the list re-render) and fixed by restoring messages onto the
   re-rendered card.
4. apps/web/style.css - scenes panel styling (dark, JetBrains Mono, status
   badges pending/passed/failed).
5. packages/providers/image/index.js - ImageProvider gains
   supportsSceneRequests (default false) and generateFromScene(); providers
   that cannot honor structured multi-character requests are refused with 501
   instead of flattening scenes into a prompt. HuggingFace adapter deliberately
   stays supportsSceneRequests=false.
6. packages/character-core/scene.js - added list() and recordGeneration().
7. tests/fixtures/providers.js - FixtureSceneImageProvider (deterministic,
   scene-capable, records the request it received; test fixture only).
8. tests/helpers.js - bootApp passes imageValidator through.

## Files created

- tests/scene-api.test.js (5 API-level tests, 9 mission scenarios)
- orchestration/receipts/SCENE-WIRING-RECEIPT.md (this file)

## API routes added

- POST /api/characters/:id/references - register reference assets at an exact
  version (404 if the character version does not exist for the tenant)
- GET  /api/characters/:id/references?version=N
- POST /api/scenes - create (422 with detailed rejection list)
- GET  /api/scenes, GET /api/scenes/:id (tenant-scoped; cross-tenant 404)
- POST /api/scenes/:id/compile - structured request (no prompt field)
- POST /api/scenes/:id/generate - 503 unconfigured / 501 provider lacks scene
  support / 502 provider failure / 200 with output recorded, validation pending
- POST /api/scenes/:id/validate - 503 no validator (real CV does not exist
  yet) / 409 nothing generated / 422 failed with reasons / 200 passed
- POST /api/scenes/:id/publish - 409 unless validationStatus is "passed"

## UI behavior added (live-verified in the browser)

- Character selection with exact version, scene role, wardrobe, pose, and
  reference-asset inputs; setting/camera/lighting/spatial fields.
- Created a scene through the UI: card rendered "pending | Nova v1 | rooftop
  bar at night" with Compile/Generate/Validate/Publish buttons.
- Generate through the UI surfaced the honest runtime state on the card:
  "503: no image provider configured (no image provider selected; set
  IMAGE_PROVIDER in .env)".
- Compile through the UI rendered the structured request preview: kind
  multi-character-image-request, correct character/version/role, hasPrompt
  false, message "compiled: 1 character block(s), no flattened prompt".

## Tests and results

`npm test`: 33/33 pass (28 prior + 5 new API tests covering the 9 required
scenarios): create via API; compile preserves both character IDs and exact
versions with no prompt field; deterministic provider receives the structured
request with both characters intact; failed validation (missing characters)
422 + publish refused + gallery verified empty; passing validation 200 +
publish 201 + asset in gallery with provenance; merge/swap rejection 422 +
publish refused; cross-tenant 404 on every scene route + cross-tenant scene
creation 422; validator absence 503 honest.

## Provider status (honest)

- Runtime: chat = ollama/qwen3:14b (live); image = not configured (503);
  image validator = none (503; real computer-vision validation does not
  exist). No real image was generated anywhere in this mission. The
  deterministic scene provider and scripted validator exist only under
  tests/fixtures/ and the no-fixtures-in-runtime guard still passes.

## Gallery publication evidence

- tests/scene-api.test.js asserts assets collection is empty after a refused
  publish and contains exactly the provenance-stamped asset after a passed
  one. UI gallery continues to show only published assets.

## Failures/errors

- Browser-pane coordinate clicks did not register during live verification
  (pane not compositing); DOM-level interaction used instead. One real UI bug
  found and fixed (message wiped by re-render), documented above.

## Known limitations

- Validation endpoint requires an injected validator; runtime has none until
  real identity detection lands.
- Configured HuggingFace would still 501 on scenes (single-subject API); the
  scene-capable real backend is the next adapter decision (ComfyUI vs HF).
- UI scene builder uses the canonical record's appearance as the appearance
  lock; per-field lock editing is future polish.
- Everything else carried from SCENE-FOUNDATION-RECEIPT.md.

## Approvals / git

- Mission approved by Trey. Nothing staged, committed, or pushed (verified:
  git diff --cached empty; modified + untracked files only).

## Final result

- done - scene layer wired end-to-end through API and UI with honest
  unconfigured states; 33/33 tests green; live-verified in the browser.

## Next action / next single milestone

- Adapter selection for real generation: ComfyUI (local 4090, workflow-based,
  best fit for reference-pack identity control) vs Hugging Face (hosted,
  simpler, weaker multi-character control). This is a product decision for
  Trey; the ComfyUI adapter implementing generateFromScene() is the
  recommended lane.
