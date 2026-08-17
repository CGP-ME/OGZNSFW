# Mission: M-20260816-003

- Mission ID: M-20260816-003
- Created: 2026-08-16T18:40:00-05:00
- Requester: Trey
- Assigned agent: Claudito
- Status: approved

## Objective

Read-only inspection: report the directory structure of the orchestration
folder and the files it contains, with a one-line description of each file's
purpose based on its content. Change nothing.

## Allowed scope

- Paths/systems the agent may touch: orchestration/ under the current
  workspace, read-only
- Actions the agent may take: read files, list directories, report findings
- Tools allowed: Read,Glob,Grep

## Forbidden actions

- Standing policies apply (see policies/). Additional prohibitions for this
  mission: no file creation, no edits, no deletions, no renames, no package
  installs, no git actions of any kind, no service actions, no Windows
  settings, no VPS, no external messages.

## Approval gates

- Brief approved by Trey: granted 2026-08-16T18:41:00-05:00
- Additional gates: none

## Verification plan

The adapter captures stdout, stderr, exit code, and timestamps to
orchestration/runs/M-20260816-003/. Trey reviews the run artifacts and the
generated receipt.

## Notes

Harmless test mission used to validate the Claudito adapter. Safe to re-run;
each run lands in its own run-stamped folder.
