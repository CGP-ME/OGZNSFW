# Receipt: M-20260819-002 (Totality Sweep - CLOSURE)

- Mission ID: M-20260819-002 (append-only; extends M-20260819-001, which
  remains as written)
- Date/time: 2026-08-19 (machine local, UTC-7)
- Requester: Trey (approved decisions 1-5 in the closure mission)
- Assigned agent: Fable (Claude Code, model claude-opus-5)
- Project: OGZNSFW `Q:/OpenClaw/workspace`. OGZPrime/OGZPMLV2 not touched.

## CENSUS

| | Sweep start (2026-08-18) | After first pass | At closure |
|---|---|---|---|
| Runtime JS files | 19 | 19 | 20 (+capabilities.js) |
| `throw` sites | 46 | 39 | 39 |
| `catch` blocks | 14 | 15 | 17 (+capability accessor probe, +health/degraded paths) |
| Silent swallows | 1 | 0 | 0 |
| Process-death paths | 1 (undiscovered) | 1 (proven, then fixed) | 0 |
| Tests | 58 | 65 | 72 |

## PHASE 1 - REGISTRY CAPABILITY VALIDATION (approved decision 1)

**Authoritative boundary identified:** `packages/providers/registry.js`
`select()` for providers the registry constructs, and `createApp()` for
components injected directly (validator, assessor, pre-built providers).
Both now call ONE contract source: `packages/providers/capabilities.js`.

**Required capabilities validated:**
- chatProvider: `name`, `chat`, `probe`
- imageProvider: `name`, `generate`, `probe`
- imageValidator: `validate`
- presentationAssessor: `assess`

**Mechanism (no duplicated truth):** the registry still owns which providers
exist and what env each needs; capabilities.js owns only "does this object
satisfy its interface". Detection is exact - a method inherited but not
overridden from the abstract base IS the stub, and is counted missing. For
the `name` accessor, reading it on an unimplemented class hits the defensive
stub, which throws; that throw is caught INSIDE validation and converted to a
named refusal. The stub therefore fires during selection, never during work.

**Result:** an implementation missing any required capability is refused at
the beginning - console banner, `refusals` entry with `missingCapabilities`,
provider replaced with an explicit `{provider: null, status:{configured:
false, reason}}`. No undefined, no empty object, no fake success.

**Interface stubs: RETAINED as defensive tripwires, now unreachable** for
anything that passes selection. Proven behaviorally, not by inspection: a
test instruments `ImageValidator.prototype.validate` and asserts it is never
entered when a broken validator is injected.

## PHASE 2 - PROCESS-LEVEL FAILURE POLICY (Trey's correction applied)

The previous handler continued after an unknown fatal event as though the
process were healthy. That was the exact failure Trey flagged. Replaced with
two explicitly separated policies:

**A. Known request failure** - route boundary catches it, error type is
preserved in the response (`errorType`), stack logged, typed 500 returned,
process continues serving. Proven: a store that throws `TypeError` yields
`500 {errorType:'TypeError'}` and the NEXT request succeeds.

**B. Unknown process-level fault** - `markProcessDegraded()` logs a fatal
banner, records the fault, and flips the service to DEGRADED. The process
stays alive (rule 1: only Trey/kill switch stop it) but:
- every `/api` route refuses 503 with the fatal evidence attached,
- `/api/health` returns **503 `status: degraded`** - it never reports healthy
  again,
- no empty/fake success is produced anywhere.
Staying alive-but-degraded is chosen over shutdown so an operator can inspect
a live process; it is explicitly NOT "continue as if healthy". This is
testable without killing the runner because the policy is an exported
function, and a test drives it directly.

**Bug found by this test:** the degraded middleware initially intercepted
`/api/health` itself, making the honest health surface unreachable exactly
when needed. Fixed - health is the one route the degraded refusal does not
intercept.

## PHASE 3 - DOCTRINE SCOPE (approved decision 2)

`orchestration/DOCTRINE.md` section 9 added, ruling application-runtime
obligations vs operator-CLI obligations verbatim as Trey stated them, plus
the process-level failure policy. States explicitly that operator-CLI scope
is not permission to bypass doctrine.

## REMAINING THROWS - 39, ALL RULED (unchanged from M-20260819-001)

12 external boundary (caught by pipeline/routes, typed, recorded) -
LEGITIMATE, rule 4 ceiling.
10 interface stubs - RETAINED as tripwires, now UNREACHABLE past selection.
10 malformed input (caught, become 422/recorded failures) - LEGITIMATE.
7 low-level, each individually traced in M-20260819-001 - LEGITIMATE, and
`seed.js:23` (the former process-death path) is contained by the boundary.

## CATCHES - 17, NONE SWALLOW

15 prior (all preserve and route failure) + 2 added by this closure: the
capability accessor probe (converts a stub throw into a named refusal) and
the degraded-state paths. Zero swallows remain in runtime.

## TESTS

72 tests, 72 pass, 0 fail. New this closure: `tests/capability-gate.test.js`
(7 tests) - valid provider passes; provider missing one method refused by
exact name; unimplemented accessor caught by validation while the stub stays
armed; validator and assessor refusals; **invalid implementation never
reaches its stub** (instrumented); registry refuses unknown provider; process
degraded-state policy end to end.

Per rule 9, the count is not offered as proof. The proof is: an executed
crash path, an instrumented stub that was never entered, and three real bugs
that fell out of writing these tests (`/api/providers` and `/api/chat` null
dereference, and the health-route interception).

## FILES CHANGED (this closure)

- `packages/providers/capabilities.js` (new)
- `packages/providers/registry.js` (capability gate at selection)
- `apps/api/server.js` (injected-component gate, process failure policy,
  `/api/health`, degraded refusal, health bypass)
- `orchestration/DOCTRINE.md` (section 9 scope ruling)
- `tests/capability-gate.test.js` (new)
- This receipt.

## FILES INTENTIONALLY EXCLUDED

`apps/web/studio/` (Cast Studio, incomplete lane). Personal workspace files
(SOUL.md, USER.md, etc.). `tools/`/`training/` scripts - audited and ruled
operator-CLI scope; no changes required.

## SAFETY EVIDENCE

No live provider contacted: every app under test declares providers null or
fixture-backed; `createChatProvider`/`createImageProvider` were called with
unroutable localhost ports for construction-only assertions and never
invoked. No credentials read. No broker exists in this project. No VPS
access. No orders. Nothing installed.

## VALIDATION

`git diff --check`: clean (only CRLF advisories). `git status`: 20 modified,
14 untracked, **nothing staged, committed, or pushed**.

## UNRESOLVED QUESTIONS

None outstanding. Both prior questions were ruled by Trey and implemented.

## IS THE SWEEP CLOSED?

Yes, for application runtime and operator CLIs in OGZNSFW. Every remaining
throw has a category, a caller/callee trace, a boundary ruling, and evidence
of containment or explicit refusal. Zero silent swallows, zero process-death
paths, zero false-success paths.

## NEXT ACTION

Trey reviews the diff and makes the commit call.
