# Receipt: M-20260817-002 (OpenClaw-Side Claudito Trigger: Design + Implementation)

- Mission ID: M-20260817-002
- Date/time: 2026-08-17T00:35:00-07:00 / 2026-08-17T00:55:00-07:00 (machine local, UTC-7)
- Requester: Trey
- Assigned agent: Fable (Claude Code session, model claude-fable-5)
- Objective: Design (read-only investigation) and then implement the smallest
  safe OpenClaw-side trigger that routes an approved mission into
  orchestration/adapters/claudito.ps1, per Trey's two-prompt sequence with
  implementation pre-approved conditional on matching the design.
- Allowed scope: read foundation docs and installed OpenClaw CLI surfaces;
  create dispatch.ps1, workspace skill, test mission, this receipt; edit only
  TOOLS.md and adapters/README.md (named in the design report); test against
  the harmless trigger-test mission only.
- Forbidden actions: no installs, no Windows settings, no OpenClaw config
  changes, no service restarts, no VPS, no external messages, no git
  add/commit/push, no deletes/moves, no recursive Claude Code calls, no real
  engineering missions.

## Design findings (from live inspection, not guesses)

- OpenClaw MCP tools available: conversations_list, conversation_get,
  messages_read, messages_send, events_poll, events_wait, attachments_fetch,
  permissions_list_open, permissions_respond. No filesystem access, no process
  launching - so the trigger must live on the OpenClaw/OS side, not the MCP.
- CRITICAL: `openclaw approvals get` shows effective exec policy
  security=full, ask=off, no exec-approvals.json, empty allowlist. The
  OpenClaw agent can already run arbitrary shell commands with no approval
  prompt. The mission-file approval gate in claudito.ps1 is therefore the
  hard control; tightening exec approvals is a recommended follow-up decision
  for Trey (config change, explicitly out of scope here).
- Trigger mechanism chosen: workspace skill (SKILL.md) + thin dispatcher
  script, invoked manually (Trey message or `openclaw agent -m`). Rejected:
  MCP tool / plugin hook (config + surface), cron (wrong model).
- Skill enablement concern resolved by test: OpenClaw auto-discovers
  workspace skills - `claudito-dispatch` lists as ready, source
  "openclaw-workspace", with zero config changes.

## Files created

1. orchestration\adapters\dispatch.ps1 (dispatcher/trigger, v0.1.0)
2. skills\claudito-dispatch\SKILL.md (OpenClaw agent usage contract)
3. orchestration\missions\trigger-test-mission.md (M-20260817-001, harmless)
4. orchestration\receipts\OPENCLAW-TRIGGER-RECEIPT.md (this file)

Created by the trigger during testing (evidence, kept):
- orchestration\runs\M-20260817-001\dispatch-20260817T004928.json + adapter
  console capture + run-<stamp>\{mission-copy, prompt, stdout.json, stderr,
  run-info.json}
- orchestration\receipts\M-20260817-001-RECEIPT.md (auto, marked done)
- orchestration\runs\M-TEST-FORBIDDEN\dispatch-20260817T004912.json (refusal
  evidence from the forbidden-action test; adapter exit 5 recorded honestly)

## Files modified (both named in the design report)

- TOOLS.md: added "Claudito mission dispatch" section (exact command + rules)
- orchestration\adapters\README.md: added dispatch.ps1 section (behavior,
  exit codes, no-git guarantee)

## Files read

- All orchestration foundation docs (current in session), adapters/claudito.ps1,
  agents/openclaw.md, agents/claudito.md, workspace AGENTS.md and TOOLS.md,
  and run artifacts of the tests.

## Commands/tools used (read-only investigation)

- openclaw skills --help / list / info coding-agent
- openclaw approvals --help / get
- openclaw agent --help, openclaw hooks --help, openclaw cron --help
- MCP tool schemas verified in-session

## Tests/checks run (all via dispatch.ps1)

| Test | Expected | Actual |
|---|---|---|
| Missing mission ID | refuse 10 | REFUSED exit 10 |
| Approval "pending" | refuse 12 | REFUSED exit 12 (dispatcher gate, before adapter) |
| Forbidden-action mission | adapter 5 passthrough | adapter exit 5 passed through; dispatch record written; no success claimed |
| Approved M-20260817-001 by ID | run, exit 0 | GREEN: adapter exit 0, child is_error=false (2 turns, Glob-only enumeration), receipt done, RESULT_JSON emitted |
| Immediate re-dispatch | refuse 13 | REFUSED exit 13 (duplicate guard; -AllowRerun documented override) |

Git check after all tests: only expected new untracked files plus the named
README edit; `git diff --cached` empty; no staging, no commit, no push.

## Approvals required / status

- Design mission: granted by Trey (Prompt 1). Implementation: pre-granted by
  Trey (Prompt 2) conditional on matching the design report - honored; only
  the design's mechanism and named files were used.
- Git actions: not requested this mission, not performed.
- Exec-approvals tightening: NOT approved, NOT performed - open decision.

## Failures/errors

- None in this mission's own steps.

## Final result

- done - Trigger built, discovered by OpenClaw as a workspace skill, and
  proven on the full gate battery plus one green end-to-end dispatch. Full
  chain now working: mission file -> dispatcher gates -> adapter gates ->
  Claude Code (read-only tools, no MCP) -> run evidence -> receipt -> git
  left to Trey.

## Unresolved questions

- Whether to enable gateway exec approvals (ask=on + allowlist) so OpenClaw's
  exec is no longer unprompted - recommended, requires Trey-approved config
  change and possibly a gateway restart.
- Committing/pushing the new trigger files to OGZaddy/OGZNSFW - awaiting
  Trey's explicit go.
- Timezone convention (still open from prior receipts).

## Next action

- Trey reviews this receipt and the M-20260817-001 evidence, then decides:
  commit/push, exec-approvals tightening, and when to authorize the first
  real (non-test) mission through the trigger.
