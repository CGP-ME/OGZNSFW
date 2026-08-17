# Adapters

Adapters are the glue that lets OpenClaw hand missions to other agents and
collect evidence back. Each adapter is a standalone script with no secrets, no
hardcoded machine paths, and no side effects beyond `orchestration/runs/` and
`orchestration/receipts/`.

## claudito.ps1 (Claude Code)

Hands an approved mission brief to Claude Code non-interactively and captures
the run as durable artifacts plus a receipt.

### Usage

```powershell
powershell -ExecutionPolicy Bypass -File orchestration\adapters\claudito.ps1 -MissionFile orchestration\missions\example-mission.md
```

Parameters:

- `-MissionFile <path>` (required) - the mission brief, written from
  `MISSION-TEMPLATE.md`.
- `-WorkspaceRoot <path>` (optional) - defaults to two levels above the script
  (adapters -> orchestration -> workspace). No drive letter, username, or
  machine name is assumed.
- `-Model <name>` (optional) - passed to `claude --model`; default is the CLI's
  configured default.
- `-AllowMcp` (optional switch) - by default the child session runs with
  `--strict-mcp-config` and no MCP config, so it loads zero MCP servers. Pass
  this switch to let the child load configured MCP servers.

### What it enforces before launching anything

1. Mission file must exist.
2. Required fields must be present: Mission ID, Requester, Objective,
   Allowed scope, Forbidden actions.
3. Mission ID must be filesystem-safe.
4. `Brief approved by Trey:` must exist and unambiguously read `granted ...`.
   Absent, `pending`, `denied`, or template-placeholder text all refuse.
   Silence is not approval.
5. Forbidden-action tripwire: the Objective and Allowed scope text is scanned
   for git/push/commit/stage, delete/remove/move/rename, restart/reboot/kill,
   install/uninstall/upgrade, VPS, registry, and Windows settings keywords.
   Any hit refuses unless the mission carries an explicit
   `- Forbidden-action approval: granted <ISO 8601> covering: <actions>` line.
   This is a deliberately coarse tripwire; false positives are accepted and
   resolved by rewording the mission or adding the explicit approval line.

### How the child session is constrained

- Verified CLI syntax (claude 2.0.35): `claude -p --output-format json
  --tools <names> --strict-mcp-config` with the prompt on stdin.
- `--tools` defaults to `Read,Glob,Grep` (read-only). A mission may change this
  with a `Tools allowed: <names>` line inside its Allowed scope section; the
  value is validated to plain tool names only.
- The child runs from the workspace root, never elevated, never with
  `--dangerously-skip-permissions`.

### What a run produces

```
orchestration/runs/<mission-id>/run-<stamp>/
  mission-copy.md   verbatim copy of the mission as executed
  prompt.txt        exact prompt sent (preamble + mission)
  stdout.json       full CLI JSON result (includes the agent's report)
  stderr.txt        captured stderr
  run-info.json     command, args, cwd, start/end times, exit code
orchestration/receipts/<mission-id>-RECEIPT.md
```

Receipts are append-only: if a receipt name already exists, a run-stamped name
is used instead of overwriting.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | executed; claude exited 0 and did not report is_error |
| 2 | mission file not found |
| 3 | mission malformed (missing fields / unsafe values) |
| 4 | approval absent or ambiguous |
| 5 | forbidden action requested without explicit approval |
| 6 | claude CLI not found or not runnable |
| 7 | claude ran but failed (non-zero exit or is_error) |
| 8 | unexpected adapter error |

### What it never does

No `git add`/`commit`/`push`, no deletes, no moves, no renames, no service
restarts, no package installs, no elevation, no writes outside
`orchestration/runs/` and `orchestration/receipts/`. Any git action on the
results is a separate, explicitly approved step by Trey.

### Known limitations

- Refused missions (exit 2-6) do not get automatic receipts; the refusal is
  reported on the console and via exit code. Blocker receipts are written by
  the caller if needed.
- The tripwire is keyword-based, not semantic. It can false-positive on
  harmless wording and cannot catch a cleverly-worded forbidden request; the
  child's restricted toolset is the real containment.
- Files read by the child are self-reported in its output; the adapter does not
  independently trace child file access.
- The child session still loads the user's global Claude configuration
  (CLAUDE.md, settings); only MCP servers are excluded by default.
