import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootSceneWorld, seedCharacter, sceneEntry, baseSceneInput } from './scene-helpers.js';
import { compileImageRequest } from '../packages/providers/image/image-request.js';
import { evaluateValidationReport } from '../packages/providers/image/image-validator.js';
import { ScriptedImageValidator } from './fixtures/validators.js';

async function sceneWithTwo() {
  const world = await bootSceneWorld();
  const tenant = 'tenant-a';
  const nova = await seedCharacter(world, tenant, 'Nova');
  const iris = await seedCharacter(world, tenant, 'Iris');
  const created = await world.scenes.create(tenant, baseSceneInput([
    sceneEntry(nova, { sceneRole: 'left foreground' }),
    sceneEntry(iris, { sceneRole: 'right foreground' }),
  ]));
  assert.equal(created.ok, true, JSON.stringify(created.errors ?? []));
  const records = {};
  for (const c of created.scene.characters) {
    records[c.characterId] = await world.characters.loadRecord(tenant, c.characterId, c.characterVersion);
  }
  const request = compileImageRequest(created.scene, records);
  return { world, tenant, nova, iris, scene: created.scene, request };
}

test('validator detects a missing character and the verdict fails', async () => {
  const { nova, iris, request } = await sceneWithTwo();
  // Scripted double: only Nova detected, Iris absent (the classic collapse)
  const validator = new ScriptedImageValidator({ detections: [{ characterId: nova.characterId, identityScore: 0.95, region: 'left' }] });
  const report = await validator.validate({ request, asset: { uri: 'about:test-output' } });
  assert.deepEqual(report.missingCharacters, [iris.characterId]);
  const verdict = evaluateValidationReport(report);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.reasons.some((r) => r.includes('missing expected character')));
});

test('validator detects an unexpected character and the verdict fails', async () => {
  const { nova, iris, request } = await sceneWithTwo();
  const validator = new ScriptedImageValidator({ detections: [
    { characterId: nova.characterId, identityScore: 0.95, region: 'left' },
    { characterId: iris.characterId, identityScore: 0.9, region: 'right' },
    { characterId: 'uninvited-third', identityScore: 0.7, region: 'center' },
  ] });
  const report = await validator.validate({ request, asset: { uri: 'about:test-output' } });
  assert.deepEqual(report.unexpectedCharacters, ['uninvited-third']);
  assert.equal(evaluateValidationReport(report).pass, false);
});

test('identity merge/swap warnings and low identity scores fail the verdict', async () => {
  const { nova, iris, request } = await sceneWithTwo();

  const merged = new ScriptedImageValidator({
    detections: [
      { characterId: nova.characterId, identityScore: 0.92, region: 'left' },
      { characterId: iris.characterId, identityScore: 0.85, region: 'right' },
    ],
    mergeSwapWarnings: [`${iris.characterId} rendered with ${nova.characterId}'s hair and tattoo`],
  });
  const mergedReport = await merged.validate({ request, asset: { uri: 'about:test-output' } });
  const mergedVerdict = evaluateValidationReport(mergedReport);
  assert.equal(mergedVerdict.pass, false);
  assert.ok(mergedVerdict.reasons.some((r) => r.includes('merge/swap')));

  const weak = new ScriptedImageValidator({ detections: [
    { characterId: nova.characterId, identityScore: 0.95, region: 'left' },
    { characterId: iris.characterId, identityScore: 0.4, region: 'right' },
  ] });
  const weakReport = await weak.validate({ request, asset: { uri: 'about:test-output' } });
  const weakVerdict = evaluateValidationReport(weakReport);
  assert.equal(weakVerdict.pass, false);
  assert.ok(weakVerdict.reasons.some((r) => r.includes('below threshold')));

  // Wardrobe/role issues alone are warnings, not failures
  const wardrobe = new ScriptedImageValidator({
    detections: [
      { characterId: nova.characterId, identityScore: 0.95, region: 'left' },
      { characterId: iris.characterId, identityScore: 0.9, region: 'right' },
    ],
    wardrobeRoleWarnings: [`${iris.characterId} wardrobe differs from scene spec`],
  });
  const wardrobeVerdict = evaluateValidationReport(await wardrobe.validate({ request, asset: { uri: 'about:test-output' } }));
  assert.equal(wardrobeVerdict.pass, true);
  assert.equal(wardrobeVerdict.warnings.length, 1);
});

test('failed validation blocks gallery publication; passed validation allows it', async () => {
  const { world, tenant, nova, iris, scene, request } = await sceneWithTwo();

  // Pending scenes cannot publish
  const pendingAttempt = await world.scenes.publishAsset(tenant, scene.id, { uri: 'about:test-output', provider: 'none', model: 'none' });
  assert.equal(pendingAttempt.ok, false);
  assert.ok(pendingAttempt.errors[0].includes('"pending"'));

  // Failed validation: publication refused, nothing stored
  const failing = new ScriptedImageValidator({ detections: [{ characterId: nova.characterId, identityScore: 0.95 }] });
  const failReport = await failing.validate({ request, asset: { uri: 'about:test-output' } });
  const applied = await world.scenes.applyValidationReport(tenant, scene.id, failReport);
  assert.equal(applied.validationStatus, 'failed');
  const failedAttempt = await world.scenes.publishAsset(tenant, scene.id, { uri: 'about:test-output', provider: 'none', model: 'none' });
  assert.equal(failedAttempt.ok, false);
  assert.equal((await world.store.find('assets', () => true)).length, 0, 'no asset may be stored from a failed scene');

  // Passed validation: publication allowed with provenance
  const passing = new ScriptedImageValidator({ detections: [
    { characterId: nova.characterId, identityScore: 0.95 },
    { characterId: iris.characterId, identityScore: 0.9 },
  ] });
  const passReport = await passing.validate({ request, asset: { uri: 'about:test-output' } });
  const applied2 = await world.scenes.applyValidationReport(tenant, scene.id, passReport);
  assert.equal(applied2.validationStatus, 'passed');
  const published = await world.scenes.publishAsset(tenant, scene.id, { uri: 'about:test-output', provider: 'none', model: 'none' });
  assert.equal(published.ok, true);
  assert.deepEqual(published.asset.provenance.expectedCharacterIds.sort(), [nova.characterId, iris.characterId].sort());

  // Cross-tenant publication is impossible
  const crossPublish = await world.scenes.publishAsset('tenant-b', scene.id, { uri: 'about:test-output', provider: 'none', model: 'none' });
  assert.equal(crossPublish.ok, false);
});
