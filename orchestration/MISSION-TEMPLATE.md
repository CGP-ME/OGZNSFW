# Mission Template

Copy this into `missions/<MISSION-ID>.md` to start a mission. A mission does not
begin execution until Trey has approved the brief (objective, scope, forbidden
actions). Keep the brief short; precision beats length.

```markdown
# Mission: <MISSION-ID>

- Mission ID: M-YYYYMMDD-NNN
- Created: <ISO 8601>
- Requester: Trey
- Assigned agent: <OpenClaw | Claudito | Mercury | Fable | Kimi>
- Status: draft | approved | in-progress | blocked | done | aborted

## Objective

One or two sentences. What outcome makes this mission done.

## Allowed scope

- Paths/systems the agent may touch:
- Actions the agent may take:

## Forbidden actions

- Standing policies apply (see policies/). Additional prohibitions for this
  mission:

## Approval gates

- Brief approved by Trey: pending | granted <ISO 8601>
- Additional gates (destructive steps, external side effects, scope changes):

## Verification plan

How the result will be checked, and by whom (self-check, Mercury, Trey).

## Notes

Context, links, prior receipts, known landmines.
```

## Rules

- One mission, one objective, one assigned agent. Split anything bigger.
- Scope changes mid-mission go back to Trey; the brief is updated and
  re-approved before work continues.
- When the mission ends (done, failed, or aborted), write the receipt per
  `RECEIPT-SCHEMA.md`, then move the brief and artifacts to `archive/`.
