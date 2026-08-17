# OpenClaw Orchestration

This directory is the coordination layer for multi-agent missions run through OpenClaw.
It defines who does what, under what authority, and how every action is recorded.

Trey is the final authority on all missions, approvals, and scope changes. No agent
overrides him, and no agent expands its own scope.

## Directory layout

- `agents/` - one contract file per agent (role, powers, hard limits)
- `missions/` - active mission briefs, written from `MISSION-TEMPLATE.md`
- `receipts/` - one receipt per completed or aborted mission (see `RECEIPT-SCHEMA.md`)
- `policies/` - standing rules that apply to every mission
- `adapters/` - adapter scripts and docs for reaching each agent (Claudito
  adapter built and proven; see `adapters/README.md`)
- `runs/` - raw run artifacts: logs, command output, intermediate files
- `inbox/` - incoming task requests not yet turned into missions
- `archive/` - closed missions and their artifacts, moved out of the active set

## Core documents

- `ROLES.md` - the authority chain and each agent's mandate
- `RECEIPT-SCHEMA.md` - required fields for every mission receipt
- `MISSION-TEMPLATE.md` - the brief format every mission starts from
- `policies/APPROVAL-POLICY.md` - what requires explicit approval before it happens
- `policies/NO-SILENT-ACTION.md` - the no-silent-action rule

## Mission lifecycle

1. A request lands in `inbox/` or arrives directly from Trey.
2. OpenClaw drafts a mission brief in `missions/` using the template.
3. Trey approves the brief (objective, scope, forbidden actions).
4. OpenClaw routes the work to the assigned agent.
5. The agent executes within scope and reports back.
6. Mercury verifies adversarially when the mission touches production paths.
7. A receipt is written to `receipts/` before the mission is called done.
8. Closed missions move to `archive/`.

## Status

Foundation plus first adapter. The structure and contracts exist, and the
Claudito adapter (`adapters/claudito.ps1`) is built and proven green end-to-end
on mission M-20260816-003. OpenClaw-side automatic routing is not built yet.
See `receipts/BOOTSTRAP-RECEIPT.md` and
`receipts/CLAUDITO-ADAPTER-DESIGN-RECEIPT.md` for what was actually done and
verified.
