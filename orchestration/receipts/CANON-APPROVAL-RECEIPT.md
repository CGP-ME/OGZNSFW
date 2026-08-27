# Receipt: M-20260818-010 (Nova v1 + Iris v1 Canon Approval)

- Mission ID: M-20260818-010
- Date/time: 2026-08-18T14:09:13-07:00
- Requester/Approver: Trey (explicit "APPROVED BY TREY" message, approved as written)
- Assigned agent: Fable (Claude Code session, model claude-fable-5)

## Approved (verbatim scope from Trey's approval)

- Nova v1: age 27, fictional adult; trigger token novaident
- Iris v1: age 29, fictional adult; trigger token irisident
- All stable identity traits, allowed variations, forbidden-drift rules as
  written in training/characters/nova.spec.json and iris.spec.json
- 16-image minimum / 24-image target; dataset diversity requirements; 30%
  max background/garment concentration; SFW, fictional-adult, no-real-person
  training restrictions

## Actions taken

- Both specStatus values set to approved-by-Trey with approval blocks
  (approver + timestamp, machine local UTC-7 per project convention).
- Spec-status test updated to enforce the approved state and trigger tokens.
- This receipt is append-only; any future identity change is an explicit
  character-version decision (v2 spec + new approval), never silent drift.

## Next

- Anchor-candidate mission (M-20260818-011): fresh SFW candidates generated
  against these approved specs; refA/refB NOT treated as canonical; nothing
  auto-approved; stops at Trey review.
