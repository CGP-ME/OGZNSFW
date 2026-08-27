# Receipt: M-20260820-001 (Character-Model Lane - State Verification + Round-2 Audit)

- Mission ID: M-20260820-001
- Date/time: 2026-08-20 (machine local, UTC-7)
- Requester: Trey (corrected mission: inspect real state, do not wait on an
  imaginary batch, advance as far as evidence allows)
- Assigned agent: Fable (Claude Code, model claude-opus-5)

## ACTUAL STARTING STATE (verified against filesystem/manifests, not memory)

1. Canon specs: Nova v1 (novaident) and Iris v1 (irisident) both
   approved-by-Trey 2026-08-18, with agePresentation amendments (late-20s
   presentation, forbidden aging cues) applied after the round-1 rejection.
2. Candidate rounds: TWO per character. r1 (seeds 500000+) and r2 (seeds
   600000+, age-presentation constrained).
3. Rejected batch: r1, both characters, 48/48 marked rejected
   ("age-presentation mismatch"), batchStatus=rejected-for-training.
   Quarantined; audit gate cannot admit them (approved-only).
4. Newer batch: YES - r2 exists, generated 2026-08-18, 24 per character,
   48/48 generated without errors.
5. Approved training images: Nova 0, Iris 0 (all 48 r2 candidates PENDING
   Trey review - nothing auto-approved, by design).
6. Approved evaluation images: Nova 0, Iris 0.
7. Dataset audit: GATE FAILS (correctly) - requires >=16 approved training
   + >=6 approved evaluation; zero approvals exist.
8. LoRA training run: NO.
9. Training tools installed: NO - verified; the only pattern match under
   Q:\AI was our own Q:\AI\training dataset directory.
10. Model downloads: NONE beyond the committed Phase 1 stack.
11. Exact blocker: TREY'S VISUAL REVIEW of round 2. This is a genuine
    visual approval decision - choosing the canonical faces - and is the one
    step only Trey can perform.

## ROUND-2 AUDIT (existing batch audited, NOT regenerated - per mission)

Per character (nova / iris identical structure):
- 24 candidates, 0 errors, 0 duplicate hashes.
- All 24 pending; none approved, none auto-approved.
- Provenance complete per candidate: candidateId, round, seed, workflow
  hash, full prompt, appended age-negatives, variation tags, output path,
  file sha256.
- Disk integrity: 6-candidate sample per set re-hashed - all match manifest,
  none missing.
- Diversity present: 4 angles x 3 lighting x 3 wardrobe x 4 backgrounds x
  3 framings (meets the spec's variety floors for a candidate pool).
- Age-presentation target recorded in the manifest (late-20s, per amended
  canon). Spec hashes recorded; note r2 spec hashes differ from r1 because
  the specs were amended (agePresentation) between rounds - expected.
- Contact sheets exist: Q:\AI\training\<char>\v1\<char>-candidates-r2-sheet.png
  (labeled ROUND 2).

VERDICT: Round 2 is READY FOR TREY REVIEW. Regenerating would discard a
valid pending batch.

## Directory structure note

candidates/ (r1, quarantined-rejected) and candidates-r2/ (pending) exist.
approved/ and evaluation/ directories do NOT exist yet - they are created
when Trey's approvals are applied, keeping candidate/approved/eval separation
physical, not just logical.

## Training-tool report: NOT PREPARED - the mission gates it behind the
dataset gate passing, which requires approvals first.

## Work completed this mission: state verification + full r2 audit + this
receipt. No files changed outside this receipt. No generation, no downloads,
no installs, no training. Tests not affected (no runtime changes).

## Git: nothing staged, committed, or pushed.

## NEXT SINGLE ACTION

Trey reviews the two ROUND 2 contact sheets and names approvals/rejections
per candidate (or asks for a round 3 with adjustments). On his picks: build
approved/ + evaluation/ split, run the dataset audit gate, and if it passes,
deliver the training-tool license/size/hash report for his approval.
