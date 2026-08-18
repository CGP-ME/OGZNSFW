# Receipt: M-20260818-004 (ComfyUI Provider Adapter + Presentation Checkpoint)

- Mission ID: M-20260818-004 (covers both missions: adapter + visual-appeal checkpoint)
- Date/time: 2026-08-18 (machine local, UTC-7)
- Requester: Trey
- Assigned agent: Fable (Claude Code session, model claude-fable-5)
- Objective: (A) ComfyUIImageProvider.generateFromScene() behind the existing
  ImageProvider interface with mocked-client tests and a labeled integration
  smoke. (B) A presentation-quality checkpoint separating identity validity,
  technical validity, visual appeal, and human approval. SFW throughout; no
  installs, no NSFW checkpoints, no VPS, nothing staged/committed/pushed.

## Files created

1. packages/providers/image/comfyui.js - ComfyUIImageProvider (+ ComfyHttpClient,
   comfyuiTuningDefaults, seedFromSceneId). supportsSceneRequests=true (only
   this provider; HuggingFace stays false). Success claimed only after
   accepted -> queued -> completed -> bytes retrieved.
2. packages/providers/image/presentation-quality.js - PresentationQualityAssessor
   interface, PresentationQualityReport shape (visualAppealScore - deliberately
   NOT an "attractiveness truth score"), evaluatePresentationReport,
   computeFinalVerdict (rejected_identity | rejected_technical |
   needs_human_review | visually_weak | presentation_ready |
   approved_for_gallery), presentationTuningConfig (maskFeather, maskOverlap,
   adapterWeight, backgroundConditioning, poseGuidance, compositionGuidance,
   aestheticThreshold; pose/composition guidance marked not implemented).
3. tools/comfyui-smoke.mjs - labeled integration smoke (real server; SFW;
   outputs saved UNPUBLISHED to gitignored tools/smoke-output/).
4. tools/workflows/two-character-phase1.json - preserved proven workflow,
   verbatim.
5. tests/comfyui-provider.test.js (7 tests, FakeComfyClient - zero network),
   tests/presentation-quality.test.js (6 tests), tests/fixtures/comfy-client.js,
   ScriptedPresentationAssessor in tests/fixtures/validators.js.

## Files modified

- packages/providers/registry.js (comfyui implemented; requiredEnv COMFYUI_URL)
- packages/providers/image/image-request.js (identity block carries gender)
- packages/character-core/scene.js (galleryPolicy; applyPresentationReport;
  approveForGallery; finalVerdict; publishAsset now requires
  approved_for_gallery - identity validator semantics untouched)
- apps/api/server.js (provenance persisted on generate; new routes:
  POST /api/scenes/:id/presentation (503 when no assessor - honest),
  POST /api/scenes/:id/approve, GET /api/scenes/:id/verdict (four axes))
- .env.example (COMFYUI_URL/COMFYUI_CHECKPOINT), .gitignore (smoke-output),
  tests/helpers.js (assessor/policy passthrough),
  tests/character-presence-validator.test.js (updated to the new gate: a
  publish now requires a recorded generation - technical axis)

## Test results

- Unit/API suite: 46/46 pass. Mocked ComfyUI client only - no network in
  unit tests (fixture client; provider constructed with injected client).
- Coverage per mission: unavailable server, malformed request, one-character,
  two-character with separate reference conditioning preserved (asserted on
  the captured workflow: two LoadImage, two IPAdapterAdvanced, per-character
  region-masked text, no merged character text, no flattened prompt),
  workflow hash + seed recorded deterministically, queue rejection / missing
  prompt-id / execution error / missing output / empty bytes all fail loudly,
  tuning hooks flow into the workflow, validator failure blocks publication,
  success publishes, tenant isolation, honest 503s, all six final verdicts,
  identity-passes-but-appeal-fails, seam/leakage/pose/composition warnings,
  human-approval gate blocks then admits, adult editorial scene accepted.

## Integration smoke (real ComfyUI called: YES; images generated: YES; SFW; none published)

Endpoint http://127.0.0.1:8188, ComfyUI 0.33.1, checkpoint
sd_xl_base_1.0.safetensors. Benchmark log (all deterministic, evidence in
tools/smoke-output/, UNPUBLISHED):

| Run | Config | Result |
|---|---|---|
| 1 | adapter defaults feather40/overlap32, derived seed | MERGED single figure |
| 2 | feather0/overlap0 (Phase 1 parity attempt) | MERGED |
| 3 | proven seed 20260818, with char-text | MERGED |
| 4 | proven seed, "no char text" (BUG: role words still emitted) | MERGED |
| 5 | verbatim Phase 1 replay | TWO FIGURES (reproducible; determinism confirmed) |
| 6 | role-text removed for real, "two separate people" wording | MERGED |
| 7 | gender-derived subject noun "two adult women" | TWO FIGURES - adapter parity achieved; seam softer than Phase 1 |

Root-cause chain (found by structural diff of generated vs preserved
workflow, then single-variable isolation):
1. BUG (fixed): sceneRole words ("left foreground") were being emitted as
   region-masked text conditioning in every adapter run; region placement now
   lives only in mask geometry, and characterTextStrength 0 emits no nodes.
2. ROOT CAUSE (fixed): generic subject nouns lose composition to the
   reference-image pull. "two separate people" merged; "two adult women"
   (now derived from the cast's canonical genders) composes two figures.
   Everything else - masks, seed, adapter params - was already at parity.

## Provenance recorded per generation

provider, comfyuiVersion, workflowHash (sha256), seed (explicit or derived
from sceneId), checkpoint, characterVersions, referenceAssets, output
filename, promptId, timestamp - persisted into the scene record and carried
into published-asset provenance.

## Why identity success alone is insufficient (presentation checkpoint)

Phase 1 proved both identities can survive, yet outputs can still be
commercially unusable: hard seams, leaked reference backgrounds, stiff
composition. The presentation checkpoint therefore tracks visual appeal as
its own axis with its own verdicts, and the gallery gate now requires all
four axes: identity passed, technical passed, presentation not rejected, and
human approval where configured. CURRENT LIMITATION: no real visual-quality
model exists - runtime returns honest 503 / needs_human_review; deterministic
doubles are tests-only. Human review remains required for real outputs.

## Known limitations

- Identity validator and presentation assessor are interfaces + doubles; all
  real-output judgments in this receipt are human visual review (mine),
  flagged for Trey's confirmation from the evidence files.
- Subject-noun sensitivity means unknown-gender casts fall back to "adults",
  which benchmark run 6 suggests is weaker; benchmark should quantify.
- Single-sample evidence per config; the planned multi-scene benchmark is the
  real measure. Seam/background leakage remedies (feather/overlap) traded
  against identity separation remain untuned - knobs exposed, defaults are
  the proven values.

## Next benchmark plan (next single milestone)

Small deterministic matrix across several two-character scenes: seeds x
{feather 0/24/48} x {overlap 0/32} x {adapter weight 0.6/0.8} x wording
variants, scored on the two axes (identity: both present/distinct/correct
sides; presentation: seam, leakage, pose, framing), human-reviewed, results
recorded as receipts. That evidence decides tuning defaults and whether
per-character LoRA training (Phase 2) proceeds.

## Git status

- Nothing staged, committed, or pushed (verified: cached diff empty).

## Final result

- done - adapter proven end-to-end against real ComfyUI with two-figure
  parity restored and root cause documented; presentation checkpoint live in
  the gallery gate; 46/46 tests green.
