# Receipt: M-20260818-005 (Two-Character Tuning Benchmark, Round 1)

- Mission ID: M-20260818-005
- Date/time: 2026-08-18 (machine local, UTC-7)
- Requester: Trey ("keep pushing" - benchmark was the agreed next milestone)
- Assigned agent: Fable (Claude Code session, model claude-fable-5)
- Objective: Deterministic tuning benchmark across two-character scenes,
  scored on Trey's two axes (identity / presentation), to set evidence-based
  adapter defaults before any LoRA investment. SFW throughout; nothing
  installed; nothing staged/committed/pushed; no publication.

## Method

tools/bench-two-character.mjs (new, repo tool): park scene x seeds
{20260818, 777} x variants A(feather0/overlap0/w0.8) B(48/0/0.8)
C(48/16/0.65) D(96/32/0.8), via ComfyUIImageProvider against local ComfyUI
0.33.1 / SDXL base. ~20s per run. Evidence: labeled contact sheets +
per-run manifests in tools/smoke-output/ (gitignored, unpublished). Scoring:
human visual review (mine, flagged for Trey's confirmation) - no automated
CV claimed.

## Results

Round 0 (8 runs, char-text on): ALL MERGED regardless of variant/seed.
Cross-referencing all runs to date isolated the cause: region-masked
per-character TEXT conditioning. Every merged run had it on; both two-figure
successes had it off; wardrobe still transferred via reference images.
FIX: characterTextStrength default 0 (nodes not emitted); wardrobe/pose stay
in the structured request for the future multi-pass refinement stage.

Round 1 (8 runs, char-text off):
| Variant | Seed 20260818 | Seed 777 |
|---|---|---|
| A feather0 | TWO FIGURES, hard boundary | MERGED |
| B feather48 | TWO FIGURES, softest boundary, identities intact | MERGED |
| C 48/16/w0.65 | TWO FIGURES, refB identity visibly degraded | MERGED |
| D 96/32 | MERGED | MERGED |

Editorial-scene confirm: B @ seed 20260818 -> TWO FIGURES (generalizes);
B @ 777 generated but not yet human-reviewed (park data predicts merge).

## Findings

1. WINNER: feather 48 / overlap 0 / weight 0.8 -> new adapter default
   (comfyuiTuningDefaults), with the evidence cited in code comments.
2. Masked per-character text conditioning is a merge driver in single-pass
   SDXL -> default off, experimental knob retained (covered by tests).
3. Weight 0.65 trades identity for nothing observable -> keep 0.8.
4. Feather 96/overlap 32 crosses back into merging -> bounded blend zone.
5. SEED-DEPENDENT COMPOSITION is a primary axis: seed 777 merges under every
   variant. Product mechanism already in place: identity validator rejects ->
   retry with a new seed. Long-term: composition/layout pass (roadmap).
6. Background leakage persists in all outputs (studio refs beat scene
   setting) - unresolved; next-tier work (background-targeted conditioning /
   multi-pass regional refinement), tracked in presentationTuningConfig.

## Changes

- packages/providers/image/comfyui.js: maskFeather default 48;
  characterTextStrength default 0 (both with benchmark citations).
- tests/comfyui-provider.test.js: default = no masked char-text; explicit
  opt-in test for the experimental path. Suite: 46/46 pass.
- tools/bench-two-character.mjs (new benchmark tool).

## Git / publication

- Nothing staged, committed, pushed, or published. All outputs SFW.

## Final result

- done - evidence-based defaults set; merge driver identified and disabled;
  seed-composition axis quantified as the next systematic risk.

## Next action

- Trey reviews contact sheets. Next lane options, in recommended order:
  (a) automatic seed-retry loop behind the validator gate (cheap, uses
  existing verdicts), (b) background-leakage attack (scene-region
  conditioning / two-pass background repaint), (c) canonical anchor approval
  + Phase 2 per-character LoRA decision.
