# Receipt: M-20260818-008 (Two-Pass Compositor: Background + Composition Lane)

- Mission ID: M-20260818-008
- Date/time: 2026-08-18 (machine local, UTC-7)
- Requester: Trey (approved lane: background leakage + composition planning)
- Assigned agent: Fable (Claude Code session, model claude-fable-5)
- Objective: attack background leakage and seed-dependent composition inside
  the hardened architecture, without touching retry/validation/provenance/
  publication. Installed components only. SFW. Nothing staged/committed/pushed.

## Design

buildTwoPassWorkflow in the ComfyUI adapter (tuning.pipelineMode='two-pass';
'single-pass' remains the default and regression-pinned baseline):
- Pass 1: base scene from text only - no identity conditioning, so the
  setting owns the background and the subject phrase owns composition.
- Pass 2..n+1: per-character regional refinement - SetLatentNoiseMask over
  the character's region + an INDEPENDENT model branch carrying only that
  character's IPAdapter (no cross-character chaining), denoise 0.5-0.6.
- Deterministic: pass-1 seed = attempt seed; character-pass seeds =
  seed+1000+i. New tuning knobs: pipelineMode, refineDenoise, refineSteps.

## Evidence (4 runs, park scene, seeds 20260818 + 777, SFW, unpublished)

- BACKGROUND LEAKAGE: SOLVED in all 4 outputs - real park environment
  (trees, lawn, light), zero studio-gray takeover.
- SEED-777 COMPOSITION: FIXED - the seed that merged under every single-pass
  variant now produces two distinct figures in both two-pass variants.
- Seams: none visible; natural body overlap and occlusion.
- Presentation quality: large jump (intentional-looking framing/lighting).
- HONEST TRADE-OFF: identity lock is SOFTER than single-pass - hair/wardrobe
  drift from references (refinement repaints over base figures at moderate
  denoise). Identity strength is now the tunable axis: candidate remedies are
  higher refineDenoise, face-focused refinement masks, and per-character
  LoRAs (Phase 2), which slot exactly into this pass structure.
- Cost: ~22-24s per image (3 KSampler passes) vs ~20s single-pass.

Evidence: tools/smoke-output/bench-park-P2*-*.png + bench-park-twopass-sheet.png
+ manifest. Assessment is human visual review (mine) - no CV claimed.

## Status / next

- Suite 55/55 before the run; regression fixture untouched (single-pass
  default unchanged). Two-pass is opt-in pending an identity-axis benchmark
  (P2 vs single-pass scored on both axes) before any default flip.
- Next decisions for Trey: (a) identity-strength benchmark round on two-pass
  (refineDenoise sweep + face-region masks), (b) Phase 2 LoRA go/no-go - the
  two-pass structure is the natural home for per-character LoRA passes,
  (c) resume Cast Studio on the now-stable backend states.
- Uncommitted: comfyui.js (two-pass builder + knobs), bench tool variants,
  this receipt.

## Final result

- done - both lane targets hit with evidence; the remaining weakness
  (identity softness under refinement) is named, measurable, and has a
  planned mechanism (LoRA) rather than a mystery.
