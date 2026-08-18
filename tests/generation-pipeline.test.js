import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GenerationPipeline, planComposition, planConditioning, attemptSeed, defaultRetryPolicy, isRetryable, classifyValidationFailure } from '../packages/generation/pipeline.js';
import { ComfyUIImageProvider } from '../packages/providers/image/comfyui.js';
import { FakeComfyClient } from './fixtures/comfy-client.js';
import { SequencedImageValidator } from './fixtures/validators.js';
import { bootApp, validCharacter } from './helpers.js';
import { configuredChat, configuredImage, FixtureChatA } from './fixtures/providers.js';

function provider(failMode) {
  return new ComfyUIImageProvider('http://fixture.invalid:0', { client: new FakeComfyClient({ failMode }), tuning: { pollIntervalMs: 1, timeoutMs: 2000 } });
}

function sceneRequest() {
  return {
    kind: 'multi-character-image-request',
    sceneId: 'scene-pipeline-1',
    tenantId: 'tenant-a',
    scene: { setting: { location: 'sunlit park' }, composition: { camera: 'two-shot', lighting: 'natural' }, relationships: [] },
    characters: [
      { characterId: 'nova', characterVersion: 3, sceneRole: 'left foreground', referenceAssets: ['asset://nova'], wardrobe: 'jacket', identityLock: true, identity: { gender: 'female' } },
      { characterId: 'iris', characterVersion: 1, sceneRole: 'right foreground', referenceAssets: ['asset://iris'], wardrobe: 'dress', identityLock: true, identity: { gender: 'female' } },
    ],
    provenance: { expectedCharacterIds: ['nova', 'iris'] },
  };
}

const bothDetected = { detections: [{ characterId: 'nova', identityScore: 0.95 }, { characterId: 'iris', identityScore: 0.92 }] };
const irisMissing = { detections: [{ characterId: 'nova', identityScore: 0.95 }] };

test('composition and conditioning plans keep each character separate', () => {
  const req = sceneRequest();
  const comp = planComposition(req, { width: 1024, height: 1024, maskFeather: 48, maskOverlap: 0 });
  assert.equal(comp.regions.length, 2);
  assert.notEqual(comp.regions[0].x, comp.regions[1].x);
  assert.equal(comp.regions[0].characterId, 'nova');
  const cond = planConditioning(req, { characterTextStrength: 0 });
  assert.equal(cond.length, 2);
  assert.deepEqual(cond.map((c) => c.characterId), ['nova', 'iris']);
  assert.equal(cond[0].textConditioning.mode, 'none');
  assert.notDeepEqual(cond[0].referenceAssets, cond[1].referenceAssets);
});

test('first attempt passes: no retry, provenance complete', async () => {
  const pipeline = new GenerationPipeline({ provider: provider(null), identityValidator: new SequencedImageValidator([bothDetected]) });
  const run = await pipeline.run(sceneRequest());
  assert.equal(run.ok, true);
  assert.equal(run.attempts.length, 1);
  assert.equal(run.provenance.selectedAttempt, 1);
  const a = run.provenance.attempts[0];
  assert.equal(a.seed, attemptSeed('scene-pipeline-1', 1));
  assert.equal(typeof a.workflowHash, 'string');
  assert.equal(a.verdict, 'passed');
  assert.equal(run.provenance.characterVersions.nova, 3);
  assert.ok(run.provenance.totalMs >= 0);
});

test('merge on attempt 1, pass on attempt 2: deterministic retry seeds, second selected', async () => {
  const validator = new SequencedImageValidator([irisMissing, bothDetected]);
  const pipeline = new GenerationPipeline({ provider: provider(null), identityValidator: validator });
  const run = await pipeline.run(sceneRequest());
  assert.equal(run.ok, true);
  assert.equal(run.attempts.length, 2);
  assert.equal(run.provenance.selectedAttempt, 2);
  assert.deepEqual(run.provenance.attempts[0].categories, ['missing_character']);
  assert.equal(run.provenance.attempts[0].verdict, 'failed');
  assert.equal(run.provenance.attempts[1].verdict, 'passed');
  // seeds are deterministic and distinct per attempt
  assert.equal(run.provenance.attempts[0].seed, attemptSeed('scene-pipeline-1', 1));
  assert.equal(run.provenance.attempts[1].seed, attemptSeed('scene-pipeline-1', 2));
  assert.notEqual(run.provenance.attempts[0].seed, run.provenance.attempts[1].seed);
});

test('all attempts fail: bounded at maxAttempts, nothing selected', async () => {
  const validator = new SequencedImageValidator([irisMissing, irisMissing, irisMissing, irisMissing]);
  const pipeline = new GenerationPipeline({ provider: provider(null), identityValidator: validator });
  const run = await pipeline.run(sceneRequest());
  assert.equal(run.ok, false);
  assert.equal(run.attempts.length, defaultRetryPolicy.maxAttempts);
  assert.equal(run.provenance.selectedAttempt, null);
  assert.match(run.reason, /all 3 attempts failed/);
  assert.equal(validator.calls, 3, 'no attempts beyond the bound');
});

test('provider errors never retry', async () => {
  for (const mode of ['unreachable', 'reject', 'no-id', 'exec-error', 'no-output']) {
    const pipeline = new GenerationPipeline({ provider: provider(mode), identityValidator: new SequencedImageValidator([bothDetected]) });
    const run = await pipeline.run(sceneRequest());
    assert.equal(run.ok, false, mode);
    assert.equal(run.attempts.length, 1, `${mode}: exactly one attempt`);
    assert.match(run.reason, /non-retryable/);
  }
});

test('malformed scene consumes no attempts; retryability classification is strict', async () => {
  const pipeline = new GenerationPipeline({ provider: provider(null), identityValidator: new SequencedImageValidator([bothDetected]) });
  const run = await pipeline.run({ kind: 'nope' });
  assert.equal(run.ok, false);
  assert.equal(run.attempts.length, 0);

  assert.equal(isRetryable(['missing_character']), true);
  assert.equal(isRetryable(['merge_swap', 'identity_below_threshold']), true);
  assert.equal(isRetryable(['other']), false);
  assert.equal(isRetryable([]), false);
  assert.deepEqual(classifyValidationFailure({ reasons: ['missing expected character(s): iris'] }), ['missing_character']);
});

test('API route: retry then publish only the passing result; failed runs leave gallery empty', async () => {
  // Scene-capable provider via fake client, sequenced validator: fail then pass
  const p = provider(null);
  const validator = new SequencedImageValidator([irisMissing, bothDetected]);
  const app = await bootApp({ chat: configuredChat(new FixtureChatA()), image: { provider: p, status: { configured: true, selected: 'comfyui', reason: null } }, imageValidator: validator });
  try {
    const { tenantId } = await app.demo();
    const mk = async (name) => {
      const c = await app.call('POST', '/api/characters', { tenant: tenantId, body: validCharacter(name) });
      await app.call('POST', `/api/characters/${c.body.id}/references`, { tenant: tenantId, body: { version: 1, assets: [{ ref: `asset://${name.toLowerCase()}`, kind: 'face' }] } });
      return { id: c.body.id, ref: `asset://${name.toLowerCase()}` };
    };
    const a = await mk('Nova'); const b = await mk('Iris');
    const entry = (c, role) => ({ characterId: c.id, characterVersion: 1, sceneRole: role, referenceAssets: [c.ref], appearanceLock: { hair: 'x' }, consent: { fictionalAdult: true, age: 25 } });
    const created = await app.call('POST', '/api/scenes', { tenant: tenantId, body: { characters: [entry(a, 'left'), entry(b, 'right')], setting: { location: 'park' } } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const sceneId = created.body.id;

    // NOTE: sequenced validator keys detections by characterId 'nova'/'iris'
    // but API characters have generated ids - remap sequences to real ids
    validator.sequences = [
      { detections: [{ characterId: a.id, identityScore: 0.95 }] },
      { detections: [{ characterId: a.id, identityScore: 0.95 }, { characterId: b.id, identityScore: 0.9 }] },
    ];

    const run = await app.call('POST', `/api/scenes/${sceneId}/generate-validated`, { tenant: tenantId });
    assert.equal(run.status, 200, JSON.stringify(run.body));
    assert.equal(run.body.attemptsUsed, 2);
    assert.equal(run.body.selectedAttempt, 2);
    assert.equal(run.body.attempts[0].verdict, 'failed');
    assert.equal(run.body.finalVerdict, 'approved_for_gallery');
    const pub = await app.call('POST', `/api/scenes/${sceneId}/publish`, { tenant: tenantId });
    assert.equal(pub.status, 201);

    // Cross-tenant: pipeline route stays isolated
    const cross = await app.call('POST', `/api/scenes/${sceneId}/generate-validated`, { tenant: 'intruder' });
    assert.equal(cross.status, 404);

    // All-fail scene: gallery stays empty for it
    validator.sequences = [{ detections: [] }];
    validator.calls = 0;
    const created2 = await app.call('POST', '/api/scenes', { tenant: tenantId, body: { characters: [entry(a, 'left'), entry(b, 'right')], setting: { location: 'harbor' } } });
    const run2 = await app.call('POST', `/api/scenes/${created2.body.id}/generate-validated`, { tenant: tenantId });
    assert.equal(run2.status, 422);
    assert.equal(run2.body.attemptsUsed, 3);
    const pub2 = await app.call('POST', `/api/scenes/${created2.body.id}/publish`, { tenant: tenantId });
    assert.equal(pub2.status, 409);
  } finally {
    await app.close();
  }
});
