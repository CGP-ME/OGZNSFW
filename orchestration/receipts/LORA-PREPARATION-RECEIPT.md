# Receipt: M-20260818-009 (Character-LoRA Preparation Lane)

- Mission ID: M-20260818-009
- Date/time: 2026-08-18 (machine local, UTC-7)
- Requester: Trey (character models first; two-pass compositor committed
  separately as 13e184b before this lane)
- Assigned agent: Fable (Claude Code session, model claude-fable-5)
- Objective: preparation only - canon specs, dataset/provenance schemas,
  audit tooling, 4090 training plan, validation plan. NO training run, NO
  installs, NO downloads, NO images generated, nothing staged/committed.

## Files created (all unstaged)

1. training/characters/nova.spec.json + iris.spec.json - versioned canon
   specs separating invariant identity / allowed variation / scene-dependent
   traits / forbidden drift / reference-pack requirements. Both marked
   draft-pending-trey-approval (enforced by test). Fictional adults only.
2. training/schemas/dataset-manifest.schema.json - manifest with tenant
   scope, hashes, captions, splits, approval records, licensing status,
   rejection reasons. Caption policy trigger-plus-variables: identity binds
   to the trigger token; wardrobe/background/lighting/pose stay promptable
   and are the ONLY captioned traits.
3. training/schemas/lora-provenance.schema.json - LoRA revision record:
   base model hash, dataset manifest hash, full training config, seed,
   validation status.
4. training/audit-dataset.mjs - readiness gate: >=16 approved training +
   >=6 approved evaluation images, no duplicate hashes, disjoint splits,
   resolved approvals with approver, no unclear licensing, rejection reasons
   mandatory, trigger token in every approved caption.
5. packages/generation/lora.js - characterLoraRef, validateLoraProvenance,
   loraUsableForPublication (validation.status must be "passed" - full
   evaluation set, never one good image).
6. training/TRAINING-PLAN.md - 4090 plan: SDXL base (RAIL++-M permits
   derivatives; hash recorded), proposed kohya-ss/sd-scripts (Apache-2.0,
   NOT installed - report-first gate), rank 16/alpha 16, LR 1e-4 unet +
   5e-5 TE, ~2000 steps, 1024 bucketed, bf16, VRAM 17-21GB (Ollama cold
   during training), ~50MB outputs under Q:\AI\training\..., append-only
   revisions with pointer-based rollback.
7. tests/lora-preparation.test.js - suite now 58/58.

## Dataset readiness: NOT READY (honest state)

Zero approved training images exist. refA/refB are single portraits -
insufficient and not yet canon-approved. Anchor sets must be generated
(two-pass single-character mode, SFW, ~30 candidates each) and approved by
Trey into manifests before the audit can pass.

## Validation plan

8-case unseen evaluation set per LoRA (neutral portrait, alternate wardrobe/
background/lighting, three-quarter, wider framing, two-character scene, seed
variation x3), scored on identity similarity, presence, drift, wardrobe/
background leakage, artifacts, prompt adherence. Human review; no CV claimed.

## Training ran: NO. Images generated: NO. License findings: in plan (SDXL
RAIL++-M derivative-permitted; kohya Apache-2.0 pending install approval).

## Blockers (ordered)

1. Trey approves/edits Nova + Iris canon specs.
2. Anchor-generation mission + Trey approval pass into dataset manifests.
3. Install approval for the training tool (source/revision/size reported).
4. Train -> provenance -> validation benchmark -> two-pass integration.

## Next single action

- Trey reviews training/characters/nova.spec.json and iris.spec.json.
