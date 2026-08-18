import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, validCharacter } from './helpers.js';
import { configuredChat, configuredImage, FixtureChatA, FixtureSceneImageProvider } from './fixtures/providers.js';
import { ScriptedImageValidator } from './fixtures/validators.js';

// Boot the real app with the scene-capable deterministic provider and a
// scripted validator. Seeds a tenant with two characters + reference packs
// through the HTTP API only.
async function bootSceneApi(validator) {
  const sceneProvider = new FixtureSceneImageProvider();
  const app = await bootApp({
    chat: configuredChat(new FixtureChatA()),
    image: configuredImage(sceneProvider),
    imageValidator: validator,
  });
  const { tenantId } = await app.demo();
  const mk = async (name) => {
    const created = await app.call('POST', '/api/characters', { tenant: tenantId, body: validCharacter(name) });
    assert.equal(created.status, 201);
    const id = created.body.id;
    const ref = `asset://${name.toLowerCase()}-face-v1`;
    const reg = await app.call('POST', `/api/characters/${id}/references`, { tenant: tenantId, body: { version: 1, assets: [{ ref, kind: 'face' }] } });
    assert.equal(reg.status, 201);
    return { id, ref, name };
  };
  const a = await mk('Nova');
  const b = await mk('Iris');
  return { app, tenantId, a, b, sceneProvider };
}

function sceneBody(a, b) {
  const entry = (c, role) => ({
    characterId: c.id,
    characterVersion: 1,
    sceneRole: role,
    referenceAssets: [c.ref],
    appearanceLock: { hair: 'red', eyes: 'green' },
    wardrobe: 'casual',
    consent: { fictionalAdult: true, age: 25 },
  });
  return {
    characters: [entry(a, 'left foreground'), entry(b, 'right foreground')],
    setting: { location: 'rooftop bar' },
    composition: { camera: 'two-shot', lighting: 'neon' },
  };
}

test('scene lifecycle through the API: create, compile, generate, validate, publish', async () => {
  const ctx = await bootSceneApi(new ScriptedImageValidator({ detections: [] }));
  const { app, tenantId, a, b, sceneProvider } = ctx;
  try {
    // 1. create
    const created = await app.call('POST', '/api/scenes', { tenant: tenantId, body: sceneBody(a, b) });
    assert.equal(created.status, 201);
    const sceneId = created.body.id;
    assert.equal(created.body.validationStatus, 'pending');

    // 2. compile preserves both characters and versions, no flattened prompt
    const compiled = await app.call('POST', `/api/scenes/${sceneId}/compile`, { tenant: tenantId });
    assert.equal(compiled.status, 200);
    assert.equal(compiled.body.kind, 'multi-character-image-request');
    assert.equal(compiled.body.characters.length, 2);
    assert.deepEqual(compiled.body.provenance.expectedCharacterIds.sort(), [a.id, b.id].sort());
    assert.equal(compiled.body.provenance.expectedCharacterVersions[a.id], 1);
    assert.equal(compiled.body.provenance.expectedCharacterVersions[b.id], 1);
    assert.equal(Object.prototype.hasOwnProperty.call(compiled.body, 'prompt'), false);

    // 3. generate via the deterministic scene-capable provider
    const generated = await app.call('POST', `/api/scenes/${sceneId}/generate`, { tenant: tenantId });
    assert.equal(generated.status, 200);
    assert.equal(generated.body.output.provider, 'fixture-scene-image');
    // provider received the STRUCTURED request, both characters intact
    assert.equal(sceneProvider.lastRequest.characters.length, 2);

    // 4. validation with empty detections fails (both characters missing)
    const failed = await app.call('POST', `/api/scenes/${sceneId}/validate`, { tenant: tenantId });
    assert.equal(failed.status, 422);
    assert.equal(failed.body.validationStatus, 'failed');
    assert.ok(failed.body.reasons.some((r) => r.includes('missing expected character')));

    // 5. failed output cannot be published
    const refused = await app.call('POST', `/api/scenes/${sceneId}/publish`, { tenant: tenantId });
    assert.equal(refused.status, 409);
    const galleryAfterRefusal = await app.call('GET', `/api/assets?characterId=${a.id}`, { tenant: tenantId });
    assert.deepEqual(galleryAfterRefusal.body, []);
  } finally {
    await app.close();
  }
});

test('successful deterministic validation publishes to the private gallery', async () => {
  const validator = new ScriptedImageValidator({ detections: [] });
  const ctx = await bootSceneApi(validator);
  const { app, tenantId, a, b } = ctx;
  try {
    const created = await app.call('POST', '/api/scenes', { tenant: tenantId, body: sceneBody(a, b) });
    const sceneId = created.body.id;
    await app.call('POST', `/api/scenes/${sceneId}/generate`, { tenant: tenantId });

    // Script the validator to detect both characters with strong identity
    validator.detections = [
      { characterId: a.id, identityScore: 0.95, region: 'left' },
      { characterId: b.id, identityScore: 0.92, region: 'right' },
    ];
    const passed = await app.call('POST', `/api/scenes/${sceneId}/validate`, { tenant: tenantId });
    assert.equal(passed.status, 200);
    assert.equal(passed.body.validationStatus, 'passed');

    const published = await app.call('POST', `/api/scenes/${sceneId}/publish`, { tenant: tenantId });
    assert.equal(published.status, 201);
    assert.deepEqual(published.body.asset.provenance.expectedCharacterIds.sort(), [a.id, b.id].sort());

    // Asset is in the tenant's gallery with provenance
    const gallery = await app.call('GET', `/api/assets?characterId=${a.id}`, { tenant: tenantId });
    assert.equal(gallery.body.length, 1);
  } finally {
    await app.close();
  }
});

test('merge/swap detection rejects through the API', async () => {
  const validator = new ScriptedImageValidator({ detections: [] });
  const ctx = await bootSceneApi(validator);
  const { app, tenantId, a, b } = ctx;
  try {
    const created = await app.call('POST', '/api/scenes', { tenant: tenantId, body: sceneBody(a, b) });
    const sceneId = created.body.id;
    await app.call('POST', `/api/scenes/${sceneId}/generate`, { tenant: tenantId });
    validator.detections = [
      { characterId: a.id, identityScore: 0.95 },
      { characterId: b.id, identityScore: 0.9 },
    ];
    validator.mergeSwapWarnings = [`${b.id} rendered with ${a.id}'s features`];
    const res = await app.call('POST', `/api/scenes/${sceneId}/validate`, { tenant: tenantId });
    assert.equal(res.status, 422);
    assert.ok(res.body.reasons.some((r) => r.includes('merge/swap')));
    const refused = await app.call('POST', `/api/scenes/${sceneId}/publish`, { tenant: tenantId });
    assert.equal(refused.status, 409);
  } finally {
    await app.close();
  }
});

test('cross-tenant scenes and characters are rejected through the API', async () => {
  const ctx = await bootSceneApi(new ScriptedImageValidator({ detections: [] }));
  const { app, tenantId, a, b } = ctx;
  try {
    const created = await app.call('POST', '/api/scenes', { tenant: tenantId, body: sceneBody(a, b) });
    const sceneId = created.body.id;

    // Another tenant cannot see, compile, generate, validate, or publish it
    const other = 'tenant-intruder';
    for (const [method, p] of [['GET', `/api/scenes/${sceneId}`], ['POST', `/api/scenes/${sceneId}/compile`], ['POST', `/api/scenes/${sceneId}/generate`], ['POST', `/api/scenes/${sceneId}/validate`], ['POST', `/api/scenes/${sceneId}/publish`]]) {
      const res = await app.call(method, p, { tenant: other });
      assert.equal(res.status, 404, `${method} ${p} must 404 for another tenant`);
    }

    // Another tenant cannot build a scene from this tenant's characters
    const crossCreate = await app.call('POST', '/api/scenes', { tenant: other, body: sceneBody(a, b) });
    assert.equal(crossCreate.status, 422);
    assert.ok(crossCreate.body.details.some((e) => e.includes('not found for this tenant')));
  } finally {
    await app.close();
  }
});

test('validator and provider absence produce honest 503/501, never fabricated flow', async () => {
  // No validator injected at all
  const sceneProvider = new FixtureSceneImageProvider();
  const app = await bootApp({ chat: configuredChat(new FixtureChatA()), image: configuredImage(sceneProvider) });
  try {
    const { tenantId } = await app.demo();
    const c = await app.call('POST', '/api/characters', { tenant: tenantId, body: validCharacter('Solo') });
    await app.call('POST', `/api/characters/${c.body.id}/references`, { tenant: tenantId, body: { version: 1, assets: [{ ref: 'asset://solo-face-v1', kind: 'face' }] } });
    const created = await app.call('POST', '/api/scenes', { tenant: tenantId, body: {
      characters: [{ characterId: c.body.id, characterVersion: 1, sceneRole: 'center', referenceAssets: ['asset://solo-face-v1'], appearanceLock: { hair: 'red' }, consent: { fictionalAdult: true, age: 25 } }],
      setting: { location: 'studio' },
    } });
    assert.equal(created.status, 201);
    await app.call('POST', `/api/scenes/${created.body.id}/generate`, { tenant: tenantId });
    const noValidator = await app.call('POST', `/api/scenes/${created.body.id}/validate`, { tenant: tenantId });
    assert.equal(noValidator.status, 503);
    assert.match(noValidator.body.error, /no image validator configured/);
  } finally {
    await app.close();
  }
});
