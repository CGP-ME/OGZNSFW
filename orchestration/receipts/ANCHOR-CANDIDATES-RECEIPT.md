# Receipt: M-20260818-011 (Nova + Iris Anchor-Candidate Generation)

- Mission ID: M-20260818-011
- Date/time: 2026-08-18 (machine local, UTC-7)
- Requester: Trey (anchor mission authorized in the canon-approval message)
- Assigned agent: Fable (Claude Code session, model claude-fable-5)
- Objective: fresh SFW candidate sets against the approved v1 specs, full
  per-candidate provenance, nothing auto-approved, stop at Trey review.

## Rules honored

- Text-only generation from approved spec language; refA/refB NOT used as
  conditioning and NOT treated as canonical. No LoRA training, no installs,
  no downloads, no production-default changes, no VPS, nothing staged/
  committed/pushed. All SFW (prompts include solo/one-person and the
  standing child/teen negative exclusions).
- Generator refuses specs whose specStatus is not approved-by-Trey.

## What was generated

- 24 candidates per character (48/48 succeeded), ~6-8s each, SDXL base via
  the committed ComfyUI adapter's single-subject path.
- Variation matrix per set: 4 angles x 3 lighting setups, with 3 wardrobe
  options, 4 backgrounds, and 3 framings cycling; deterministic seeds
  500000-500023.
- Outputs quarantined at Q:\AI\training\{nova,iris}\v1\candidates\ -
  clearly separate from any approved training data (none exists yet).
- Pending-approval manifests (repo, unstaged):
  training/datasets/nova-v1-candidates.json and iris-v1-candidates.json -
  per candidate: candidateId, seed, workflow hash, full prompt, variation
  tags, output path, file sha256, approval.status=pending.
- Review contact sheets: Q:\AI\training\{nova,iris}\nova/iris-candidates-sheet.png

## Honest expectation for review

Candidates are text-only, so faces vary across seeds by design - this review
IS the moment Trey picks the canonical face. Recommended review method:
choose the candidates that look like the SAME person matching the spec;
approve those; reject the rest with reasons (the manifest fields are ready).
If the approved subset is too small or lacks variety for the 16/24 gate, a
second candidate round anchored on the approved picks (reference-conditioned
this time) fills the set coherently - that round is a follow-up mission.

## Suite

- 58/58 before generation.

## Next single action

- Trey reviews both contact sheets and marks approvals/rejections (I will
  apply his picks to the manifests - he never needs to edit JSON).
