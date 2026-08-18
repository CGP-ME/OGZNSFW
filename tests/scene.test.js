import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootSceneWorld, seedCharacter, sceneEntry, baseSceneInput } from './scene-helpers.js';

test('single-character scene creation succeeds with full provenance', async () => {
  const world = await bootSceneWorld();
  const tenant = 'tenant-a';
  const nova = await seedCharacter(world, tenant, 'Nova');
  const result = await world.scenes.create(tenant, baseSceneInput([sceneEntry(nova)]));
  assert.equal(result.ok, true, JSON.stringify(result.errors ?? []));
  assert.equal(result.scene.validationStatus, 'pending');
  assert.deepEqual(result.scene.generation.expectedCharacterIds, [nova.characterId]);
  assert.equal(result.scene.generation.expectedCharacterVersions[nova.characterId], 1);
  assert.equal(result.scene.generation.status, 'planned');
});

test('multi-character scene creation binds both characters at exact versions', async () => {
  const world = await bootSceneWorld();
  const tenant = 'tenant-a';
  const nova = await seedCharacter(world, tenant, 'Nova');
  const iris = await seedCharacter(world, tenant, 'Iris');
  const input = baseSceneInput([
    sceneEntry(nova, { sceneRole: 'left foreground' }),
    sceneEntry(iris, { sceneRole: 'right foreground', wardrobe: 'green dress' }),
  ], { relationships: [{ between: [nova.characterId, iris.characterId], type: 'friends', description: 'longtime friends' }] });
  const result = await world.scenes.create(tenant, input);
  assert.equal(result.ok, true, JSON.stringify(result.errors ?? []));
  assert.equal(result.scene.characters.length, 2);
  assert.deepEqual(result.scene.generation.expectedCharacterIds.sort(), [nova.characterId, iris.characterId].sort());
});

test('duplicate character IDs are rejected', async () => {
  const world = await bootSceneWorld();
  const tenant = 'tenant-a';
  const nova = await seedCharacter(world, tenant, 'Nova');
  const result = await world.scenes.create(tenant, baseSceneInput([sceneEntry(nova), sceneEntry(nova, { sceneRole: 'right' })]));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('duplicate character IDs')));
});

test('missing or wrong character version is rejected', async () => {
  const world = await bootSceneWorld();
  const tenant = 'tenant-a';
  const nova = await seedCharacter(world, tenant, 'Nova');

  const noVersion = await world.scenes.create(tenant, baseSceneInput([sceneEntry(nova, { characterVersion: undefined })]));
  assert.equal(noVersion.ok, false);
  assert.ok(noVersion.errors.some((e) => e.includes('exact integer characterVersion')));

  const wrongVersion = await world.scenes.create(tenant, baseSceneInput([sceneEntry(nova, { characterVersion: 7 })]));
  assert.equal(wrongVersion.ok, false);
  assert.ok(wrongVersion.errors.some((e) => e.includes('version 7 not found')));
});

test('identity-locked character without reference assets is rejected; missing pack is rejected', async () => {
  const world = await bootSceneWorld();
  const tenant = 'tenant-a';
  const nova = await seedCharacter(world, tenant, 'Nova');

  const noRefs = await world.scenes.create(tenant, baseSceneInput([sceneEntry(nova, { referenceAssets: [] })]));
  assert.equal(noRefs.ok, false);
  assert.ok(noRefs.errors.some((e) => e.includes('require at least one reference asset')));

  const unknownRef = await world.scenes.create(tenant, baseSceneInput([sceneEntry(nova, { referenceAssets: ['asset://does-not-exist'] })]));
  assert.equal(unknownRef.ok, false);
  assert.ok(unknownRef.errors.some((e) => e.includes('does not resolve')));
});

test('tenant isolation: scenes and characters are invisible across tenants', async () => {
  const world = await bootSceneWorld();
  const nova = await seedCharacter(world, 'tenant-a', 'Nova');
  const created = await world.scenes.create('tenant-a', baseSceneInput([sceneEntry(nova)]));
  assert.equal(created.ok, true);

  // Tenant B cannot read tenant A's scene
  const crossRead = await world.scenes.get('tenant-b', created.scene.id);
  assert.equal(crossRead, null);

  // Tenant B cannot build a scene on tenant A's character
  const crossBuild = await world.scenes.create('tenant-b', baseSceneInput([sceneEntry(nova)]));
  assert.equal(crossBuild.ok, false);
  assert.ok(crossBuild.errors.some((e) => e.includes('not found for this tenant')));
});

test('cross-tenant reference assets are rejected even for an owned character', async () => {
  const world = await bootSceneWorld();
  // Tenant A owns a pack ref; tenant B owns their own character but points at A's ref
  const novaA = await seedCharacter(world, 'tenant-a', 'Nova');
  const novaB = await seedCharacter(world, 'tenant-b', 'Vera');
  const result = await world.scenes.create('tenant-b', baseSceneInput([
    sceneEntry(novaB, { referenceAssets: [novaA.ref] }),
  ]));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('does not resolve')));
});

test('fictional-adult safety metadata is enforced on every scene character', async () => {
  const world = await bootSceneWorld();
  const tenant = 'tenant-a';
  const nova = await seedCharacter(world, tenant, 'Nova');

  const underage = await world.scenes.create(tenant, baseSceneInput([sceneEntry(nova, { consent: { fictionalAdult: true, age: 17 } })]));
  assert.equal(underage.ok, false);
  assert.ok(underage.errors.some((e) => e.includes('18 or older')));

  const ambiguous = await world.scenes.create(tenant, baseSceneInput([sceneEntry(nova, { consent: { fictionalAdult: true } })]));
  assert.equal(ambiguous.ok, false);
  assert.ok(ambiguous.errors.some((e) => e.includes('explicit integer')));

  const notFictional = await world.scenes.create(tenant, baseSceneInput([sceneEntry(nova, { consent: { fictionalAdult: false, age: 25 } })]));
  assert.equal(notFictional.ok, false);

  const ageMismatch = await world.scenes.create(tenant, baseSceneInput([sceneEntry(nova, { consent: { fictionalAdult: true, age: 30 } })]));
  assert.equal(ageMismatch.ok, false);
  assert.ok(ageMismatch.errors.some((e) => e.includes('does not match canonical record age')));

  const nonconsentText = await world.scenes.create(tenant, baseSceneInput([sceneEntry(nova)], {
    setting: { location: 'a scene against her will' },
  }));
  assert.equal(nonconsentText.ok, false);
  assert.ok(nonconsentText.errors.some((e) => e.includes('blocked')));

  const mismatchDeclared = await world.scenes.create(tenant, {
    ...baseSceneInput([sceneEntry(nova)]),
    generation: { expectedCharacterIds: ['someone-else'] },
  });
  assert.equal(mismatchDeclared.ok, false);
  assert.ok(mismatchDeclared.errors.some((e) => e.includes('does not match scene characters')));
});
