# Receipt: M-20260818-012 (Round-1 Rejection + Round-2 Anchor Candidates)

- Mission ID: M-20260818-012
- Date/time: 2026-08-18 (machine local, UTC-7)
- Requester: Trey ("REJECT THE CURRENT ANCHOR BATCH FOR TRAINING")
- Assigned agent: Fable (Claude Code session; model switched to Opus 5 mid-lane, same thread/context)

## Round-1 rejection (recorded, irreversible for training)

- All 48 candidates (nova 24, iris 24) marked approval.status=rejected with
  reason "age-presentation mismatch: reads substantially older than approved
  canon age". Batch-level batchStatus=rejected-for-training with Trey's three
  reasons: age-presentation mismatch, mature facial-aging drift, insufficient
  match to approved canon.
- Manifests renamed to *-candidates-r1.json; images remain quarantined at
  Q:\AI\training\<char>\v1\candidates\. No rejected image may enter any
  training or evaluation split (audit gate enforces approved-only).
- Canonical ages UNCHANGED (Nova 27, Iris 29). No training, no downloads,
  no tool installs.

## Doctrine change (the durable lesson)

Numeric age is METADATA; visual age presentation is a SEPARATE validation
gate. Both must pass before an image enters a training set. Encoded as:
- New agePresentation block in both approved specs (amendedBy Trey,
  2026-08-18): target presentation, positiveCues, forbiddenAgingCues.
  Constrains presentation DOWNWARD ONLY toward the canonical adult age,
  never below adult.
- Generator feeds positiveCues into the subject phrase (leading position -
  word order is load-bearing for SDXL) and forbiddenAgingCues into the
  negative prompt.
- SAFETY INVARIANT: ComfyUIImageProvider.generate() now takes extraNegative
  which is APPENDED to the mandatory base negatives. The child/teenager
  exclusions are structurally impossible for any caller to replace or
  remove - verified by construction in the code path.

## Round-2 generation

- 24 candidates per character, 48/48 succeeded, ~6s each, fresh deterministic
  seeds 600000-600023, same variation matrix (4 angles x 3 lighting, 3
  wardrobes, 4 backgrounds, 3 framings).
- Quarantined at Q:\AI\training\<char>\v1\candidates-r2\; manifests
  training/datasets/<char>-v1-candidates-r2.json with full provenance per
  candidate (seed, workflow hash, prompt, appended negatives, variation tags,
  file sha256) and approval.status=pending. NOTHING auto-approved.
- Contact sheets labeled "ROUND 2": Q:\AI\training\<char>\v1\<char>-candidates-r2-sheet.png

## Observed result (human review, mine - Trey's review is authoritative)

- Age presentation now reads late-20s across both sets; the mature-aging
  drift that failed round 1 is gone.
- Known gaps for Trey's eye: identity consistency still varies seed to seed
  (expected - text-only round); Nova's undercut and forearm tattoo appear
  inconsistently; several Nova candidates render monochrome; Iris hair length
  varies from short bob to long waves against canon "long auburn".
- Recommended path remains: Trey approves the subset that reads as ONE
  person matching canon; if the approved subset is under the 16-image gate,
  round 3 is reference-anchored on his picks to fill variety with the face
  locked.

## Git

- Nothing staged, committed, or pushed.

## Next single action

- Trey reviews the two ROUND 2 sheets and names approvals/rejections.
