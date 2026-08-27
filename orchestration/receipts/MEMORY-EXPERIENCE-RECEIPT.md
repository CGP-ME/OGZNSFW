# Receipt: M-20260820-002 (Memory Experience - Truthful Scoring + Transient Feedback)

- Mission ID: M-20260820-002
- Date/time: 2026-08-20 (machine local, UTC-7)
- Requester: Trey (split ruling: runtime end here; visual design handed to
  the design tool via a rewritten prompt reflecting the real data contract)
- Assigned agent: Fable (Claude Code, model claude-opus-5)

## SCORING LOGIC DISCOVERED (the audit's answer)

Importance was HARD-CODED in HeuristicMemoryExtractor (name 5, call-me 5,
remember 4, likes 3) with no reason stored, and MemoryStore.save silently
defaulted any missing/invalid importance to 3 via `|| 3` - an invented score
and a silent default (doctrine violation). The mission's suspicion was
correct. Also verified: the "persistent Memory saved chat element" described
in the mission does NOT exist in the shipped UI - that was the design mock;
the real transcript never had memory bubbles. Part 1 therefore ADDED the
transient confirmation rather than removing a bubble.

## SCORE: REPLACED with the explicit rubric (not removed)

RETENTION_RUBRIC (defined once, packages/memory/index.js), meaning =
retention priority, never emotional judgment:
1 casual / 2 short-term context / 3 recurring preference or meaningful fact
/ 4 durable personal or identity fact / 5 boundary or safety-critical.

classifyRetention(kind) returns {importance, importanceReason, confidence}.
Mapping per the mission's examples: boundary -> 5; explicit remember -> 4;
name / call-me -> 4 (was 5; mission example rules name=4); preference -> 3;
favorite -> 3 (via preference); casual/transient -> 2; unclassified ->
NAMED baseline 2 ("unclassified entry - baseline retention priority"),
confidence null - no fake score when classification is unavailable.

New extraction patterns (required for truthful scoring): boundary
statements ("never bring up X", "that's a hard boundary") -> 5, and
transient cravings -> 2. Everything else unchanged.

Stored per memory: importance, importanceReason, confidence (separate value,
pattern certainty), sourceType (chat-extraction-heuristic | manual),
retention: 'active', createdAt, tenantId, characterId. save() now REFUSES:
importance without a reason, non-integer/out-of-range importance, missing
sourceType - named refusals, nothing written. The `|| 3` silent default is
gone. Manual API saves carry sourceType 'manual'; user-specified importance
gets reason "user-specified retention priority".

Editing controls: NOT added - no tenant-scoped memory-update endpoint
exists, so values display read-only per the mission's rule.

## NOTIFICATION BEHAVIOR (final)

Chat save -> transient toast bottom-right: memory text + "(retention n/5)",
~4s TTL + 0.4s fade, click-to-dismiss, aria-live polite. Save FAILURE ->
distinct error toast naming the refusal; nothing claims saved; no durable
record written (refusal happens in the store). The transcript never gains a
memory bubble (addMsg roles remain user/assistant/blocked only - enforced by
test). Durable records remain in the Memories panel, which now shows
retention n/5, the importanceReason line, hover detail (confidence, source),
and the required caption: "Importance reflects retention priority, not
emotional judgment."

## FILES CHANGED

packages/memory/index.js (rubric, classifier, extractor, store fields +
refusals); apps/api/server.js (manual sourceType, full records in chat
response); apps/web/{index.html, app.js, style.css} (toasts, memories panel,
caption); tests/memory-scoring.test.js (new, 7 tests); tests/memory.test.js
(record shape). Read first: all of the above pre-change + chat UI + routes.

## TESTS: 79/79 pass

New coverage maps to the mission's 16 items: explicit-remember=4,
boundary=5, durable=4/preference=3, casual low, importance!=confidence,
reason persisted+displayed, sourceType persisted, refused bare scores,
named-baseline for unclassifiable, full records + named failures in the chat
response, tenant isolation re-asserted, transcript-clean + toast-lifecycle
static checks, fixtures guard still green. Two test fixes en route: one OLD
test used "my ex" which the real-person safety gate correctly blocks
(safety semantics untouched - test reworded), one expected string memories.

## BROWSER SMOKE (real server, real model)

- Found live: qwen3:14b was MISSING (Ollama auto-updated 0.32.0->0.32.14 and
  the model did not survive; an unexplained nomic-embed-text:274MB appeared
  ~25h ago - not pulled by this session). Re-pulled the previously-approved
  artifact (Trey's own prior command), preloaded with a patient client.
- Real chat: "Remember that I keep my keys by the door." -> real qwen3 reply,
  memory saved, visible in Memories with reason; transcript ends clean
  (user/assistant only).
- Toast lifecycle verified live: save + error variants at opacity 1,
  auto-removed by ~7s, DOM count 0. (Mid-generation toast was missed by poll
  timing on the real message; the component was then driven directly through
  the same code path.)
- Failure honesty verified live: while the model was missing, the UI showed
  the exact provider error (502, "model not found") - no false success.
- Console: one 502 resource error from that period - the honest failure
  itself, not a UI defect. No other console errors.

## TENANT-ISOLATION EVIDENCE

Cross-tenant memory list returns [] (asserted in the new API test);
MemoryStore scope tripwires unchanged and still under test.

## KNOWN LIMITATIONS

Heuristic extraction remains pattern-based (confidence numbers are pattern
certainties, honestly labeled); no memory-edit API; the design-tool
presentation (Cast Studio visual language) is handed off via prompt - this
UI is the utilitarian implementation of the same contract.

## NOT TOUCHED

Safety semantics, chat behavior beyond the response payload, retrieval
ranking, OGZPrime/VPS/OpenClaw config, Cast Studio.

## GIT

Nothing staged, committed, or pushed.
