# Receipt: M-20260818-007 (Image Continuity Architecture Hardening)

- Mission ID: M-20260818-007
- Date/time: 2026-08-18 (machine local, UTC-7)
- Requester: Trey ("build it right from the start" - stop tuning, harden)
- Assigned agent: Fable (Claude Code session, model claude-fable-5)
- Objective: promote the feasibility spike into stable abstractions with
  strict separation of powers. No deletions of working code, no installs, no
  new image generation, no VPS, nothing staged/committed/pushed.

## Stable abstractions delivered (packages/generation/pipeline.js)

- CompositionPlan (planComposition): canvas, camera/lighting, per-character
  regions (order, x/width, feather). The naive ordered-slice planner is one
  pure function - a real layout pass replaces it without touching downstream.
- CharacterConditioningPlan (planConditioning): per-character references,
  identity lock, adapter weight/type, and an EXPLICIT record of text
  conditioning mode ('none' by benchmark evidence vs 'experimental-masked-
  text') so provenance shows what was and was not conditioned.
- GenerationAttempt: attempt, seed, workflowHash, output, error, validation,
  duration - recorded for every try including failures.
- RetryPolicy (defaultRetryPolicy + isRetryable + classifyValidationFailure):
  see SEED-RETRY-RECEIPT.md.
- GenerationProvenance: scene, tenant, provider, cast versions, full attempt
  trail, selected attempt, policy, total time.
- PublicationDecision: unchanged home - computeFinalVerdict/finalVerdict on
  the scene service; the gallery gate accepts only approved_for_gallery.

## Separation of powers (enforced by structure and tests)

- Provider generates only; generateFromScene(request, {seed}) accepts a
  pipeline-driven seed; it never retries, validates, or publishes.
- Pipeline owns attempts/retries/provenance; it never publishes.
- Validators report; they never publish (unchanged interfaces).
- Gallery gate owns publication; unvalidated output cannot enter (verified:
  pipeline-failed scene -> publish 409; assets collection empty).
- Validation axes kept distinct: technical (generation/retrieval failures
  recorded on the attempt), presence + identity separation (image-validator
  report categories), presentation review (presentation-quality layer),
  human approval (explicit, recorded) - each with its own verdict surface.
- Scene compiler continues to carry per-character identity blocks; the
  no-flattened-prompt guarantees remain under test.

## Benchmark preserved as regression fixture

- tests/fixtures/benchmark-regression.json pins the winning configuration
  (feather 48 / overlap 0 / weight 0.8 / char-text 0) and the canonical
  workflow hash (3fce14f8...) for the benchmarked request at seed 20260818.
- tests/benchmark-regression.test.js fails if defaults drift from the
  benchmark winner or the workflow builder output changes - drift now
  requires a deliberate re-benchmark + fixture update with a receipt.

## Honesty boundaries (restated, unchanged)

- No real CV identity validation exists; no aesthetic automation exists.
  Deterministic doubles are tests-only; runtime returns honest 503 /
  needs-human-review states.

## Files created/modified

- Created: packages/generation/pipeline.js, tests/generation-pipeline.test.js,
  tests/benchmark-regression.test.js, tests/fixtures/benchmark-regression.json,
  SequencedImageValidator fixture, this receipt + SEED-RETRY-RECEIPT.md.
- Modified: packages/providers/image/comfyui.js (seed override param, no
  behavior change otherwise), apps/api/server.js (generate-validated route),
  packages/character-core/scene.js (recordFailedRun), apps/web/app.js
  (attempt display).

## Tests

- Full suite 55/55: two-character compilation plans, separate conditioning
  plans, failed-attempt recording, retry eligibility, non-retryable
  provider/safety errors, publication blocked before gates, provenance
  completeness, seed reproducibility, tenant isolation, benchmark
  regression pins, plus all 46 pre-existing tests unchanged.

## Git

- Nothing staged, committed, or pushed. Commit of the full pile is Trey's
  call (recommended next, per his own sequencing, before background-leakage
  work).

## Final result

- done - spike promoted to architecture; retry, provenance, and publication
  gates live behind stable interfaces; benchmark locked as a baseline.
