# Build Doctrine

Trey's doctrine, stated 2026-08-18. This governs HOW we build. It outranks
any agent's architectural preference, including mine. Where this conflicts
with something an agent thinks is elegant, this wins.

**Canonical source:** this is the OGZNSFW-local statement. The full accumulated
doctrine (57 files) lives in `C:\Users\og_za\Downloads\claudememories.zip` and
on the VPS at `/home/linuxuser/.claude/projects/-opt-ogzprime-OGZPMLV2/memory/`.
It is NOT auto-loaded - read it. The rules below that carry a memory name in
brackets come from there verbatim in substance.

Additional governing rules from that set, applying here in full:

- **Bandaid vs fix** [feedback-bandaid-vs-fix]: a fix closes the MECHANISM. A
  bandaid closes a symptom and opens a new one. Before shipping, answer: what
  was the symptom, what was the mechanism, does this close the mechanism? If
  it only blocks this expression, it is a bandaid and must be named as one.
- **Default to the hard path** [feedback-default-to-hard-path]: when one
  option feels like "the responsible choice that respects the deadline" and
  the other is "right but more work" - take more work. The responsible
  framing is the agent's own pull masquerading as judgment.
- **No deferred** [feedback-no-deferred]: a known problem is fixed right then.
  Severity orders the queue; it never means skip.
- **Rule spirit over rule letter** [feedback-rule-letter-vs-rule-spirit]: a
  rule bans the class, not the named mechanism. Arguing from technicality IS
  the violation. No output pre-filters either - read the raw output.
- **Working != correct** [feedback-working-vs-correct]: the mechanic
  happening is only half. It must also be happening on the right target.

## 1. The Fourth Shape

Fix it upstream. Head it off at the pass.

When something can go wrong, the answer is not a downstream gate, throw,
catch, retry, or guard that copes with the bad state. The answer is the
change that makes the bad state impossible to create in the first place.

- A gate that catches a problem we could have prevented is a failure of
  design, not a feature.
- Before adding a check, ask what upstream shape removes the need for it.
- The fourth shape is the one that fixes the cause. Take that one.

## 2. Right the first time, fullest ability

- No "good enough for now."
- No shortcuts that create a second job later.
- Do the whole thing, correctly, while we are in there.

## 3. Explore all viable options

Not the first right-looking one. Enumerate the real alternatives, weigh them,
then choose - and say why the others lost. One plausible answer is not an
evaluation.

## 4. Runtime is incapable of being silent

Absolutely banned in runtime code:

- Silent throws. Silent catches. Swallowed errors.
- Fallbacks that quietly substitute different behavior.
- Defaults that make a decision the caller did not state.
- Coalescing that turns missing data into a plausible-looking value.
- "Unknown", "n/a", or placeholder values standing in for real state.
- Deferrals: no "I'll do this later", no TODO left behind, no
  "future milestone" written into a path we are building right now.

If a value is required, its absence is an error - loudly, at the point of
absence, naming what was missing and who should have supplied it.

## 5. Fail LOUD to quarantine

Where a check or gate genuinely must exist (a real external boundary, not a
substitute for fixing upstream):

- It fails loudly. It names what failed and why.
- It quarantines the artifact - the bad state is retained as evidence, never
  discarded, never published, never presented as success.
- Unassessed is NOT the same as passed. An axis that was never evaluated
  quarantines; it does not fall through to approval.

## 6. No silent overrides. One config spot.

- Every knob, threshold, policy, and default lives in ONE configuration
  module. Not scattered across the files that happen to use them.
- Nothing overrides a stated value silently. An override is explicit,
  visible, and recorded in provenance.

## 7. No improvising. Ask.

Two seconds to ask beats two weeks to unwind a guess found a week later with
three layers built on top of it. He always finds it.

- If the intent is ambiguous, stop and ask one short question.
- Never invent behavior, naming, structure, or policy and proceed as if it
  were decided.

## 8. Ship certainty

Ship "I know hands down without a doubt that this works." Never "eh, that'll
work." Anything built below that bar gets redone when he sees it - so build
it above the bar the first time.

## 9. Scope: application runtime vs operator CLI

Ruled by Trey 2026-08-19. Scope changes WHICH obligations apply. It is never
permission to bypass doctrine.

**APPLICATION RUNTIME** (`apps/`, `packages/`, `db/` - the resident service):
- Must preserve typed failures.
- Must not silently swallow errors.
- Must not return fake empty data.
- Must not claim completion without evidence.
- Must quarantine recoverable external failures.
- Must preserve tenant, safety, and publication boundaries.
- Must not terminate on a request failure.

**OPERATOR CLIS** (`tools/`, `training/` - one-shot commands, not resident
runtime):
- May exit non-zero.
- Must print REFUSED or FAILED before exiting.
- Must identify the reason and leave the relevant evidence.
- Must not silently swallow errors.
- Must not claim success after failure.
- Must not install, delete, move, commit, push, contact external services,
  or start live work without explicit authorization.

**Process-level failure policy** (Trey's correction, 2026-08-19): a known
request failure and an unknown process-level fault are different events with
different policies. A request failure returns a typed 4xx/5xx and the service
keeps serving. An unknown process-level fault cannot prove runtime soundness:
the process stays alive (only Trey and the kill switch stop it) but marks
itself DEGRADED, refuses API work by name with the fatal evidence attached,
and never reports healthy again until an operator clears it. A global handler
that continues as though healthy is a violation.

## 10. Whose architecture

Trey's. Agents implement his shape, propose alternatives inside it, and do
not substitute their own preferred design. Proposals are welcome; silent
substitution is not.

---

# Live violation register (self-audit 2026-08-18)

Found by auditing my own code against this doctrine the day it was stated.
Status is updated in place as each is fixed; entries are never deleted.

| # | Location | Violation | Severity | Status |
|---|---|---|---|---|
| V1 | character-core/scene.js galleryPolicy | `requireHumanApproval: false` default - a policy the caller never stated silently permits publication | CRITICAL | FIXED |
| V2 | providers/image/presentation-quality.js computeFinalVerdict | no presentation report fell through to `approved_for_gallery` - unassessed treated as passed | CRITICAL | FIXED |
| V3 | apps/api/server.js createApp | `store/chat/image ?? create...()` - implicit construction; caller believes it configured the app, silently gets something else | HIGH | FIXED |
| V4 | character-core/scene.js recordFailedRun | `failureReason: reason ?? 'unknown'` - swallows why a run failed | HIGH | FIXED |
| V5 | providers/image/comfyui.js | reference-resolver strategy chosen silently, never recorded in provenance | MEDIUM | FIXED |
| V6 | orchestration/adapters/claudito.ps1 | silent catch on stdout parse - kept a placeholder excerpt instead of reporting the parse failure | MEDIUM | FIXED |
| V7 | orchestration/adapters/dispatch.ps1 | `-ErrorAction SilentlyContinue` on prior-dispatch scan - a listing failure reads as "no prior dispatches", weakening the duplicate guard | MEDIUM | FIXED |
| V8 | comfyui.js, presentation-quality.js, pipeline.js, server.js, registry.js | Config scattered across five files, each defining its own defaults - and I made it worse by inlining a gallery policy into server.js the same day the doctrine was stated | HIGH | FIXED - all knobs now live in packages/config/index.js; those modules define no defaults of their own |

Remaining `??` uses in runtime after this pass are output-shaping only (JSON
response fields where null is the honest, recorded value), not decisions.
Any future one that decides something is a violation.
