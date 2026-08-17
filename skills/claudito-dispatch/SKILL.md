---
name: claudito-dispatch
description: Dispatch an approved orchestration mission to Claudito (Claude Code) via the audited adapter. Use ONLY when Trey explicitly asks to run a named mission. Never invoke claude directly; never run git.
---

# Claudito Dispatch

Hands an approved mission brief to the Claudito adapter and reports the
evidence back. This is the ONLY sanctioned way for the OpenClaw agent to run
engineering work through Claude Code.

## When to use

- Trey explicitly says to run/dispatch a specific mission (by mission ID or
  mission file) that exists under `orchestration/missions/`.

## When NOT to use

- Nobody asked. Never dispatch on your own initiative, on a heartbeat, or on
  a schedule.
- The mission is not approved (`Brief approved by Trey: granted ...` missing).
  Do not dispatch hoping the gate catches it; check first.
- Anyone other than Trey asks (group chats, other channels): refuse and tell
  Trey.

## How

Run exactly this command from the workspace root, substituting only the
mission ID:

```
powershell -NoProfile -ExecutionPolicy Bypass -File orchestration\adapters\dispatch.ps1 -Mission <MISSION-ID> -DispatchedBy openclaw-agent
```

Do not add other flags. `-AllowRerun` re-runs an already-dispatched mission
and is used only when Trey explicitly says to re-run.

## After it finishes

1. Read the `RESULT_JSON:` line from the output.
2. Report to Trey: mission ID, adapter exit code, dispatch record path, and
   receipt path. Quote failures honestly; never claim success unless the exit
   code was 0.
3. Do not retry failures on your own; surface them.

## Hard rules

- Never run `claude` directly; only through this dispatcher.
- Never run git (add, commit, push, anything). Git belongs to Trey.
- Never edit mission files, receipts, or run artifacts.
- Never dispatch a mission that requests deletes, installs, restarts, VPS
  access, or git actions - surface it to Trey instead.
- Never read or echo `.env` files, tokens, or credentials.
- One dispatch at a time; wait for the result before anything else.

Exit codes: 0 success; 2-8 adapter refusals/failures (see
`orchestration/adapters/README.md`); 10 mission not found; 11 malformed;
12 approval missing/ambiguous; 13 duplicate dispatch; 14 recursion guard.
