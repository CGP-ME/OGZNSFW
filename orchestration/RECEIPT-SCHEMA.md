# Mission Receipt Schema

Every mission produces exactly one receipt in `receipts/`, written before the
mission is reported as done. A mission without a receipt is not done. Aborted
and failed missions get receipts too.

File name: `<MISSION-ID>-RECEIPT.md`

All timestamps are ISO 8601. No field may be omitted; use `none` or `n/a`
explicitly rather than leaving a field out.

## Required fields

| Field | Meaning |
|---|---|
| Mission ID | Unique ID, format `M-YYYYMMDD-NNN` (or a named ID for one-offs) |
| Date/time | ISO 8601 start and end of the mission |
| Requester | Who asked for this (normally Trey) |
| Assigned agent | Which agent executed (OpenClaw, Claudito, Mercury, Fable, Kimi) |
| Objective | The approved objective, verbatim or faithfully condensed |
| Allowed scope | Paths, systems, and actions the mission was permitted to touch |
| Forbidden actions | Explicit prohibitions in force for this mission |
| Files read | Every file inspected to do the work |
| Commands/tools used | Exact commands and tools invoked |
| Files created or changed | Full paths; state created vs modified for each |
| Tests/checks run | What was verified and how, with results |
| Approvals required | Which approval gates applied |
| Approval status | For each gate: granted / denied / not needed, and by whom |
| Failures/errors | Exact errors encountered, even if recovered |
| Final result | Done / partial / failed / aborted, with a one-line outcome |
| Unresolved questions | Open decisions that belong to Trey |
| Next action | The single next step, or `none` |

## Rules

- Receipts are append-only history. Never edit a receipt after the fact to make
  a mission look cleaner; write a follow-up receipt instead.
- No claim without evidence: "tests pass" requires naming the tests and results;
  "verified" requires saying how.
- If an agent did nothing in a category, the receipt says so explicitly.
- Receipts must not contain secrets, tokens, or credentials.

## Example skeleton

```markdown
# Receipt: M-20260816-001

- Mission ID: M-20260816-001
- Date/time: 2026-08-16T17:40:00-05:00 / 2026-08-16T17:55:00-05:00
- Requester: Trey
- Assigned agent: Claudito
- Objective: ...
- Allowed scope: ...
- Forbidden actions: ...
- Files read: ...
- Commands/tools used: ...
- Files created or changed: ...
- Tests/checks run: ...
- Approvals required: ...
- Approval status: ...
- Failures/errors: none
- Final result: done - ...
- Unresolved questions: none
- Next action: none
```
