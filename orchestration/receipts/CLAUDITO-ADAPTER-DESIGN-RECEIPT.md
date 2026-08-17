# Receipt: M-20260816-002 (Claudito Adapter Design and Test)

- Mission ID: M-20260816-002
- Date/time: 2026-08-16T19:05:00-07:00 / 2026-08-16T19:30:00-07:00 (machine local time, UTC-7)
- Requester: Trey
- Assigned agent: Fable (Claude Code session, model claude-fable-5)
- Objective: Build and test a minimal, controlled, auditable, portable Claudito
  adapter that hands a mission brief to Claude Code non-interactively and
  captures the result as durable run artifacts plus a receipt.
- Allowed scope: create orchestration/adapters/claudito.ps1,
  orchestration/adapters/README.md, orchestration/missions/example-mission.md,
  and this receipt; read foundation docs; inspect the claude CLI; test against
  the example mission only; git status inspection only.
- Forbidden actions: no package installs, no Windows settings changes, no VPS,
  no secrets exposure, no git add/commit/push, no deletes, no service
  restarts, no files outside scope.

## Exact CLI facts (inspected, not guessed)

- CLI version: `claude --version` -> 2.0.35 (Claude Code)
- `claude` on PATH resolves to the npm shim
  `...\npm\claude.ps1`; a `.cmd` sibling exists and is what the
  adapter launches (a process launcher cannot exec a .ps1 directly).
- Non-interactive invocation syntax, verified from `claude --help`:

  ```
  claude -p --output-format json --tools <names> --strict-mcp-config [--model <name>]
  ```

  - `-p/--print`: non-interactive; prompt is read from stdin (delivered from
    prompt.txt via stdin redirection).
  - `--output-format json`: single JSON result object on stdout, including
    `is_error`, `result`, `session_id`, usage.
  - `--tools`: print-mode-only restriction of the built-in toolset; adapter
    default is `Read,Glob,Grep` (read-only).
  - `--strict-mcp-config` with no `--mcp-config`: child loads zero MCP servers.
  - `--dangerously-skip-permissions` exists and is never used.
- `claude mcp --help` inspected: subcommands serve/add/remove/list/get/add-json;
  not needed by the adapter.

## Files created

1. orchestration\adapters\claudito.ps1 (adapter, v0.1.0)
2. orchestration\adapters\README.md (usage, gates, exit codes, limitations)
3. orchestration\missions\example-mission.md (harmless read-only mission M-20260816-003)
4. orchestration\receipts\CLAUDITO-ADAPTER-DESIGN-RECEIPT.md (this file)

Created by the adapter during testing (evidence, kept):

- orchestration\runs\M-20260816-003\run-20260816T192108\{mission-copy.md,
  prompt.txt, stdout.json, stderr.txt, run-info.json}
- orchestration\receipts\M-20260816-003-RECEIPT.md (auto-generated, records the
  failed child run honestly)

Test fixtures were written to the session scratchpad outside the workspace
(test-missing-approval.md, test-forbidden.md), deliberately not into the repo.

## Files read

- orchestration\README.md, ROLES.md, RECEIPT-SCHEMA.md, MISSION-TEMPLATE.md,
  policies\APPROVAL-POLICY.md, policies\NO-SILENT-ACTION.md, agents\*.md,
  receipts\BOOTSTRAP-RECEIPT.md (foundation docs; authored earlier this
  session, re-read where load-bearing: RECEIPT-SCHEMA.md, MISSION-TEMPLATE.md,
  agents\claudito.md)
- Run artifacts of the test run (stdout.json, stderr.txt, generated receipt)

## Files not touched

- All pre-existing workspace files: AGENTS.md, BOOTSTRAP.md, HEARTBEAT.md,
  IDENTITY.md, SOUL.md, TOOLS.md, USER.md, .openclaw\, .git\
- All pre-existing orchestration files (no existing file modified)
- OpenClaw config, Windows settings, VPS, credentials: untouched

## Test commands and results

All via `powershell -NoProfile -ExecutionPolicy Bypass -File claudito.ps1 -MissionFile <path>`:

| Test | Input | Expected | Actual |
|---|---|---|---|
| Missing mission | nonexistent path | refuse, exit 2 | REFUSED exit 2, correct message |
| Missing approval | fixture with `pending` | refuse, exit 4 | REFUSED exit 4: "Approval status is not an unambiguous grant: 'pending'" |
| Forbidden action | fixture asking delete + git push | refuse, exit 5 | REFUSED exit 5, tripwire hits listed: git push, commit, push, delete |
| Harmless mission | example-mission.md | run, capture, receipt | Ran; child FAILED (see below); adapter exit 7; all artifacts + receipt produced |

Child run evidence (run-20260816T192108): stdout.json captured (724 bytes),
stderr.txt captured (empty), run-info.json has command/args/cwd/start/end/exit,
receipt generated and correctly marked "failed", exit codes propagated
(child 1 -> adapter 7).

Git check: `git status --short` identical before and after (only pre-existing
untracked entries); `git diff --cached` empty both times. Nothing staged,
nothing committed, nothing pushed.

## Approval behavior (verified by test)

- Approval must read `granted ...`; `pending`, `denied`, absence, or template
  placeholder text refuse with exit 4. Silence is not approval.
- Forbidden-action tripwire scans Objective + Allowed scope; any hit refuses
  with exit 5 unless the mission carries an explicit
  `Forbidden-action approval: granted <ISO 8601> covering: <actions>` line.

## Failures/errors

- The harmless mission's child run failed: Claude Code CLI returned exit 1
  with `is_error: true` and result
  `API Error: 401 authentication_error "OAuth access token is invalid" - Please run /login`
  (194s duration, 0 tokens used). This is a CLI credential problem on this
  machine, not an adapter defect. Per mission instruction, no workaround was
  invented and no credentials were read or modified. The adapter failed
  clearly: honest receipt, evidence retained, machine-readable exit 7.

## Known limitations

- Blocked: headless `claude -p` cannot authenticate until Trey re-logs the CLI
  (interactive `claude` then `/login`, or `claude setup-token`). Until then
  every child run will fail with the 401 above.
- Refused missions (exit 2-6) do not get automatic receipts; refusal is
  console + exit code only.
- Forbidden-action tripwire is keyword-based, not semantic; false positives
  are accepted, and a cleverly-worded request could slip past it. The real
  containment is the child's restricted toolset (`--tools Read,Glob,Grep`).
- Child file reads are self-reported by the child, not independently traced.
- Child still loads the user's global Claude config (CLAUDE.md, settings);
  only MCP servers are excluded by default.
- Machine local timezone is UTC-7; earlier receipts hand-wrote UTC-5.
  Timestamp timezone convention is still an open question for Trey.

## Security considerations

- No secrets read, logged, or embedded. Adapter never elevates, never uses
  `--dangerously-skip-permissions`, never runs git, never deletes/moves.
- Child default is read-only tools + zero MCP servers; widening either
  requires an explicit mission line (`Tools allowed:`) or flag (`-AllowMcp`).
- Tools and model values are validated against safe character sets before
  being placed on a command line; mission IDs validated before use as paths.

## Portability notes

- No hardcoded username, drive letter, machine name, session ID, repo, or VPS.
- Workspace root defaults to two levels above the script and can be overridden
  with `-WorkspaceRoot`. `claude` is resolved from PATH at runtime, with
  explicit .ps1-shim to .cmd fallback.

## Approvals required / status

- Brief approval: granted by Trey via the mission instruction itself, 2026-08-16.
- Git actions: not requested, not performed. Confirmed: no commit or push
  occurred in this mission.

## Final result

- Partial. Adapter built, all four gate tests pass, capture/receipt pipeline
  proven end-to-end on a real child run. The child run itself is blocked by an
  invalid CLI OAuth token on this machine; harmless-mission success cannot be
  claimed and is not claimed.

## Unresolved questions

- Trey to re-authenticate the Claude Code CLI for headless use.
- Timestamp timezone convention (UTC-7 machine vs UTC-5 written earlier).
- Whether orchestration/ should be committed (unchanged from bootstrap receipt).

## Next action

- Next missing integration step (not implemented): after CLI re-auth, re-run
  `claudito.ps1 -MissionFile orchestration\missions\example-mission.md` to
  prove a green end-to-end run, then design the OpenClaw-side trigger that
  invokes this adapter from a gateway mission (OpenClaw exec approval flow),
  turning mission handoff from manual to orchestrated.
