# Receipt: M-20260819-001 (Totality Sweep - Failure Behavior, CLOSED)

- Mission ID: M-20260819-001 (append-only; supersedes nothing, adds to the
  partial sweep reported 2026-08-18)
- Date/time: 2026-08-19 (machine local, UTC-7)
- Requester: Trey
- Assigned agent: Fable (Claude Code, model claude-opus-5)
- Project: OGZNSFW (`Q:/OpenClaw/workspace`). OGZPMLV2 untouched - the
  mandate named it, the evidence was OGZNSFW's, I stopped and asked, Trey
  ruled "we're working in NSFW, that's our lane."

## CENSUS - BEFORE / AFTER (counted, not estimated)

| | Before first pass | After first pass | After this closure |
|---|---|---|---|
| Runtime JS files | 19 | 19 | 19 |
| `throw` sites | 46 | 39 | 39 |
| `catch` blocks | 14 | 14 | 15 (+1 boundary) |
| Silent swallows | 1 | 0 | 0 |
| Process-death paths | 1 (UNKNOWN at the time) | 1 (undiscovered) | 0 |

## THE FINDING THIS SWEEP EXISTED TO CATCH

Chasing individual throws was the wrong altitude. The real defect was that
the API layer had **no error boundary at all**.

PROVEN by execution (not by reading source) on express 4.22.2 + node 22:
express does not await async handlers, so a throw escaping any route becomes
an unhandled rejection, and Node terminates the process. A single bad request
could kill the service - a direct violation of rule 1 ("nothing shuts down my
bot altogether"). Reachable in the shipped code via `POST /api/auth/demo`
(seedDemo throws, no catch) and via any corrupted-JSON read in the store.

FOURTH SHAPE APPLIED: one boundary installed at the producer (route
registration), not 39 downstream guards. An escaped throw now quarantines
THAT REQUEST - typed error preserved (`errorType` in the response), loud
evidence emitted with stack, 500 returned - and the process survives. A
process-level guard catches anything escaping even that, screams, and keeps
the service up.

## THROW-BY-THROW RULING (39 remaining, every one ruled)

**12 external-boundary throws** - comfyui.js (HTTP transport, queue reject,
exec error, no output, empty bytes), chat/index.js:41 (Ollama HTTP),
image/index.js:45 (HuggingFace HTTP).
Caller: `pipeline.run()` and the scene/asset routes. Caught: YES -
pipeline.run catches per attempt and records `{error, retryable:false}` into
the attempt record; routes catch and return 502. Error type preserved: YES
(message carried into the attempt + response). Evidence: YES (attempt record
+ console). Boot-reachable: no. Ruling: **LEGITIMATE** - rule 4 names true
boundaries as the quarantine ceiling. No change.

**10 interface-contract stubs** - ChatProvider/ImageProvider/ImageValidator/
PresentationQualityAssessor/MemoryExtractor `must be implemented`.
Caller: only a subclass that failed to implement. Caught: by the request
boundary. Ruling: **LEGITIMATE, NOT CONVERTED** - removing them would mean
silently returning `undefined` into provenance, which rule 5 forbids more
strongly. The fourth shape (validate provider shape at registry selection so
the stubs become unreachable) is IDENTIFIED but NOT IMPLEMENTED: it adds
machinery, and rule 17 says not without Trey's word. Open question below.

**10 malformed-input throws** - comfyui.js buildSceneWorkflow x2, reference
resolution x4, image-request.js compile x3, server.js:276 record resolution.
Caller: `compileForScene` / `generateFromScene`. Caught: YES - every call
site is inside a try/catch that returns 422/502 with the message, and
pipeline.run converts them to non-retryable recorded failures. Ruling:
**LEGITIMATE** - contained, loud, evidenced.

**7 low-level, individually traced:**
- `db/store.js:16` bad collection name - internal programming error, caught
  by the request boundary. LEGITIMATE.
- `db/store.js:26` rethrow of non-ENOENT - correct: NOT swallowing a real
  filesystem error. LEGITIMATE and required.
- `pipeline.js:100` constructor requires a provider - construction time,
  caller is the route inside try/catch. LEGITIMATE.
- `lora.js:9` characterLoraRef required fields - pure function, no runtime
  caller yet (LoRA lane not wired). LEGITIMATE, re-check when wired.
- `memory/index.js:57` extractor stub - counted in interface stubs above.
- `apps/api/seed.js:23` demo seed rejected - **was the reachable
  process-death path**; now contained by the request boundary. LEGITIMATE
  post-boundary.
- `comfyui.js:65` / `chat:23` / `image:30` constructor arg checks - reached
  only via the registry, which already refuses on missing `requiredEnv`
  before construction. LEGITIMATE (unreachable in practice).

## PRODUCER DEFECTS FOUND BY THE NEW TESTS (fixed upstream, not hidden)

The failure tests immediately caught two real bugs of the same class: routes
dereferenced `chat.status` / `image.provider` without handling a dependency
explicitly declared `null` - which the doctrine REQUIRES callers to be able
to do. `/api/providers` and `/api/chat` 500'd instead of returning honest
503s. Both fixed at the producer; all such dereferences are now guarded
(verified by grep: zero remaining).

## CATCH INVENTORY (15)

14 pre-existing: all preserve and route the failure (502/422 responses or
recorded attempt evidence). 0 swallow. The one former swallow
(`apps/web/app.js` `res.json().catch(() => ({}))`) was removed on 2026-08-18
and now names the parse failure. +1 new: the request boundary, which is the
opposite of a swallow - it exists to make failures loud and survivable.

## TOOLS / TRAINING AUDIT (was skipped; now done)

4 operator scripts, all enumerated: `tools/bench-two-character.mjs`,
`tools/comfyui-smoke.mjs`, `tools/generate-anchor-candidates.mjs`,
`training/audit-dataset.mjs`.
- 0 throws. 3 catches, all of which log the failure and continue or exit
  loudly - no swallows.
- 6 `process.exit` calls, all in operator CLIs with a printed REFUSED/FAILED
  line first (loud refusal at the beginning: the anchor generator refuses to
  run against a spec that is not `approved-by-Trey`; the dataset auditor
  exits non-zero when a manifest is not ready).
- Classification: OPERATOR SCRIPTS, not bot runtime. A CLI exiting non-zero
  is the correct loud refusal for a CLI; rule 1's "never process death"
  governs the service, not a one-shot operator command. No changes made.

## TESTS

`tests/failure-behavior.test.js` added - 7 tests that drive real failure
paths (not source inspection): escaped throw quarantines the request with
`errorType` preserved AND the service still answers the next request;
startup refusal names all 6 unstated capabilities and data routes 503;
unstated publication policy quarantines publishing only while scene reads
still work; tenant-scope tripwires refuse without throwing and without
crossing scope; a failed run records explicit absence instead of "unknown";
an unparseable response never becomes an empty object; no provider is
contacted anywhere in the suite.

Full suite: 65 tests, 65 pass, 0 fail. Per rule 9 this count is NOT offered
as proof of anything - the proof is that the boundary was demonstrated by
executing a real crash path, and that two genuine bugs fell out of it.

## SAFETY EVIDENCE

No live broker exists in this project (no broker code, no orders, no
credentials). No external provider was contacted by the test suite - every
app under test declares providers `null` or fixture-backed, and no
`COMFYUI_URL` / `OLLAMA_URL` / `HF_TOKEN` is read in tests. No VPS access.

## FINAL STATE

- All silent swallows: GONE (0).
- Process-death paths: GONE (0) - boundary proven by execution.
- False-success paths: none found; the escaped-throw case explicitly asserts
  it does NOT return an empty array.
- Fourth Shape: FULLY applied to the failure-behavior producer (one boundary
  at route registration). PARTIALLY applied to interface stubs - the upstream
  registry validation is identified but not built.

## UNRESOLVED QUESTIONS (for Trey)

1. Interface stubs: build the registry-level provider-shape validation
   (loud refusal at the beginning, stubs become unreachable), or leave the
   stubs as-is now that the request boundary contains them? It is new
   machinery, so it needs your word.
2. Should operator scripts under `tools/`/`training/` be formally declared
   out of runtime scope in DOCTRINE.md, so this classification is ruled
   rather than assumed?

## GIT

Nothing staged, committed, or pushed.

## NEXT ACTION

Trey rules on the two open questions; then the commit call for the doctrine
+ sweep lane.
