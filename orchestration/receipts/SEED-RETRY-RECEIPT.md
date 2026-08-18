# Receipt: M-20260818-006 (Bounded Seed Retry Behind the Continuity Validator)

- Mission ID: M-20260818-006
- Date/time: 2026-08-18 (machine local, UTC-7)
- Requester: Trey
- Assigned agent: Fable (Claude Code session, model claude-fable-5)
- Objective: generate -> validate -> retry on identity/composition failures
  with new deterministic seeds -> stop after N -> publish only after
  validation passes. Note: implemented directly at its architectural home
  (GenerationPipeline, per the hardening mission that followed) rather than
  inside the provider - the provider never owns retries.

## Behavior delivered (packages/generation/pipeline.js + route)

- Retryable (new seed): missing character, unexpected character, merge/swap,
  identity score below threshold. Non-retryable (immediate stop, recorded):
  provider unreachable, workflow rejected, queue failure, execution error,
  missing output, malformed scene (consumes zero attempts), cross-tenant
  (404 before the pipeline), safety failures (blocked at scene creation),
  missing reference assets (compile failure).
- maxAttempts default 3; seeds deterministic per (sceneId, attempt) via
  sha256 - the full sequence is reproducible; no infinite loops (hard bound,
  verified by validator call count in tests).
- Recorded per attempt: number, seed, workflow hash, verdict, failure
  categories, duration, error; plus selected attempt, policy, total time.
- Gallery: only the first passing result is recorded/publishable; all-fail
  runs are stored via recordFailedRun (attempts retained as unpublished
  evidence, scene failed, publish 409, nothing presented as completed).
- Route: POST /api/scenes/:id/generate-validated. UI scene card shows
  "attempt N/3", per-attempt verdicts + retry reasons, and the final
  accepted/rejected state, including the all-attempts-failed message.
- No validator configured -> honest single attempt, "needs human review",
  no blind retries.

## Tests (part of 55/55 green suite)

first-pass-no-retry; fail-then-pass (second selected, distinct deterministic
seeds); all-fail bounded at 3 with empty gallery; five provider-error modes
never retry; malformed consumes no attempts; strict retryability
classification; API route end-to-end retry->publish; cross-tenant 404;
every seed/verdict recorded. No real provider calls in unit tests.

## Git

- Nothing staged, committed, or pushed.

## Final result

- done - bounded deterministic retry live behind the validator gate.
