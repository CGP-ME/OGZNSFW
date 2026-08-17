# Mission: M-20260817-001

- Mission ID: M-20260817-001
- Created: 2026-08-17T00:45:00-07:00
- Requester: Trey
- Assigned agent: Claudito
- Status: approved

## Objective

Read-only trigger test: list the files under the orchestration directory and
report the count of files per subdirectory. Read no secrets. Change nothing.

## Allowed scope

- Paths/systems the agent may touch: orchestration/ under the current
  workspace, read-only
- Actions the agent may take: read files, list directories, report findings
- Tools allowed: Read,Glob,Grep

## Forbidden actions

- Standing policies apply (see policies/). Additional prohibitions for this
  mission: no file creation, no edits, no deletions, no renames, no package
  installs, no git actions of any kind, no service actions, no Windows
  settings, no VPS, no external messages, no reading of .env or credential
  files.

## Approval gates

- Brief approved by Trey: granted 2026-08-17T00:46:00-07:00
- Additional gates: none

## Verification plan

Dispatched through orchestration/adapters/dispatch.ps1; the adapter captures
stdout, stderr, exit code, and timestamps; the dispatcher records the trigger
evidence. Trey reviews the dispatch record and receipt.

## Notes

Harmless test mission for the OpenClaw-side dispatch trigger. First dispatch
is the canonical test; re-runs require -AllowRerun by design.
