# Receipt: M-20260817-003 (Multi-Character Consistency Foundation)

- Mission ID: M-20260817-003
- Date/time: 2026-08-17T06:20:00-07:00 / 2026-08-17T06:45:00-07:00 (machine local, UTC-7)
- Requester: Trey
- Assigned agent: Fable (Claude Code session, model claude-fable-5)
- Objective: Build the structured scene/identity/provenance layer for reliable
  multi-character image generation - the architecture that prevents scenes
  from collapsing into the main character. No provider connections, no video,
  no billing/auth, no git actions.
- Allowed scope: OGZNSFW repository only (root verified:
  `git rev-parse --show-toplevel` = Q:/OpenClaw/workspace, HEAD 3ac15b6).
  New scene-layer modules + tests + this receipt.
- Forbidden actions: no package installs, no real image provider or HF token,
  no video, no billing/auth, no stage/commit/push, no unrelated file edits,
  no OGZPrime/VPS/OpenClaw-config/Windows changes.

## Files read

- README.md, packages/character-core/index.js, packages/providers/{registry.js,
  chat/index.js, image/index.js}, packages/safety/index.js,
  apps/api/{server.js, seed.js}, apps/web/{index.html, app.js, style.css},
  db/store.js, all existing tests, orchestration/README.md,
  orchestration/RECEIPT-SCHEMA.md. (All authored earlier this session and
  unchanged; state current in working context, verified against HEAD 3ac15b6.)

## Files created

1. packages/character-core/scene.js - Scene record: characters (exact
   versions, roles, appearance locks, wardrobe, pose, consent), setting,
   relationships, composition (spatial/camera/lighting), generation
   provenance, validation status. SceneService: create (full validation),
   scoped get, applyValidationReport, publishAsset (gallery gate).
2. packages/character-core/reference-pack.js - reference assets keyed by
   tenant_id + character_id + character_version; resolve() returns null for
   any out-of-scope ref (cross-tenant, wrong version, unknown).
3. packages/providers/image/image-request.js - compiles a scene into a
   structured multi-character request: per-character identity blocks kept
   separate from each other and from scene-level instructions; no flattened
   prompt field exists anywhere in the shape; provenance carries expected
   character IDs and exact versions.
4. packages/providers/image/image-validator.js - ImageValidator interface,
   report shape (expected/detected/missing/unexpected/identityScores/
   merge-swap/wardrobe-role), deriveValidationReport, and deterministic
   verdict rules (missing, unexpected, merge/swap, or sub-threshold identity
   scores fail; wardrobe/role issues warn).
5. tests/scene-helpers.js, tests/fixtures/validators.js (ScriptedImageValidator
   - a clearly-labeled deterministic double), tests/scene.test.js,
   tests/multi-character-image-request.test.js,
   tests/character-presence-validator.test.js
6. orchestration/receipts/SCENE-FOUNDATION-RECEIPT.md (this file)

## Files modified

- tests/multi-character-image-request.test.js (own file, during the run): the
  no-fixtures-in-runtime guard initially flagged a code COMMENT in
  packages/providers/chat/index.js that mentions "tests/fixtures/"; the guard
  was tightened to match real import statements only. No runtime file was
  changed to make a test pass.

## Tests run and results

`npm test`: 28/28 pass (12 pre-existing + 16 new). New coverage maps to the
mission's 16 required tests:

1. Single-character scene creation: pass
2. Multi-character scene creation: pass
3. Duplicate character rejection: pass
4. Missing/wrong version rejection: pass (undefined version AND nonexistent v7)
5. Missing reference-pack rejection: pass (empty refs AND unresolvable ref)
6. Tenant isolation: pass (cross-tenant scene read null; cross-tenant
   character build refused; cross-tenant publishAsset refused)
7. Cross-tenant reference rejection: pass (tenant B's own character pointing
   at tenant A's ref refuses)
8. Structured request preserves both characters: pass
9. Separate per-character identity instructions: pass (distinct locked
   attributes, per-character distinctness clause, no shared identity object)
10. Validator detects missing character: pass (verdict fails)
11. Validator detects unexpected character: pass (verdict fails)
12. Identity merge/swap detection: pass (verdict fails; low identity score
    also fails; wardrobe-only issues warn without failing)
13. Failed validation blocks gallery publication: pass (pending AND failed
    scenes refuse publishAsset; assets collection verified empty after refusal)
14. Fictional-adult rules enforced: pass (age 17, ambiguous age, non-fictional,
    consent/record age mismatch, nonconsent text in setting, declared-vs-actual
    character mismatch all refuse)
15. No runtime file imports test fixtures: pass (import-statement guard across
    apps/, packages/, db/)
16. No real provider call in tests: pass (static guard: scene.js,
    reference-pack.js, image-request.js, image-validator.js contain no fetch
    calls; no provider adapter is constructed in any new test)

## Provider / generation / video status

- No provider was called. No real image was generated. No HF token used or
  present. Video was not touched. The validator is an interface with
  deterministic test doubles - REAL COMPUTER-VISION VALIDATION DOES NOT EXIST
  YET and nothing claims it does.

## Tenant-isolation evidence

- tests/scene.test.js "tenant isolation" and "cross-tenant reference assets"
  blocks; tests/character-presence-validator.test.js cross-tenant publish
  refusal. Reference lookups are structurally scoped: the store key includes
  tenant_id + character_id + character_version and out-of-scope resolves null.

## Safety-test evidence

- tests/scene.test.js "fictional-adult safety metadata" block (6 rejection
  cases listed above), reusing packages/safety checkText for scene free text.
  Existing 12 safety/isolation/provider tests still pass unchanged.

## Failures/errors

- One intermediate test failure (guard false-positive on a comment), fixed by
  tightening the guard regex; documented under Files modified.

## Known limitations

- Validator implementations are test doubles; real identity detection (face
  embedding match against reference packs) is future work.
- Scene layer is not yet wired into apps/api HTTP routes or the web UI; it is
  a validated architecture layer with service-level tests.
- Reference assets are refs/metadata; binary asset storage is future work.
- checkText remains pattern-based (documented since the MVP receipt).

## Approvals / git

- Mission approved by Trey (the mission message). Nothing staged, committed,
  or pushed; `git status` shows only new untracked files plus this receipt.

## Final result

- done - scene/reference/request/validator architecture built and fully
  tested; 28/28 suite green; no providers touched.

## Unresolved questions

- none for this mission; wiring and real validation are next-milestone
  decisions for Trey.

## Next action / next single milestone

- Wire the scene layer into the API + UI (create scene, compile request,
  route through the ImageProvider interface, run validator, gallery-gate) so
  the structure carries end-to-end - still provider-agnostic, with the
  ComfyUI adapter as the natural real-generation follow-up.
