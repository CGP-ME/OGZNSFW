import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootSceneWorld, seedCharacter, sceneEntry, baseSceneInput } from './scene-helpers.js';
import { compileImageRequest } from '../packages/providers/image/image-request.js';

async function buildTwoCharacterScene() {
  const world = await bootSceneWorld();
  const tenant = 'tenant-a';
  const nova = await seedCharacter(world, tenant, 'Nova');
  const iris = await seedCharacter(world, tenant, 'Iris');
  const created = await world.scenes.create(tenant, baseSceneInput([
    sceneEntry(nova, { sceneRole: 'left foreground', appearanceLock: { hair: 'jet black', eyes: 'gray', identifyingMarks: ['circuit tattoo'] } }),
    sceneEntry(iris, { sceneRole: 'right foreground', appearanceLock: { hair: 'auburn', eyes: 'green', identifyingMarks: [] }, wardrobe: 'green dress' }),
  ]));
  assert.equal(created.ok, true, JSON.stringify(created.errors ?? []));
  const records = {};
  for (const c of created.scene.characters) {
    records[c.characterId] = await world.characters.loadRecord(tenant, c.characterId, c.characterVersion);
  }
  return { world, tenant, nova, iris, scene: created.scene, records };
}

test('structured request preserves both characters with separate identity blocks', async () => {
  const { scene, records, nova, iris } = await buildTwoCharacterScene();
  const request = compileImageRequest(scene, records);

  assert.equal(request.kind, 'multi-character-image-request');
  assert.equal(request.characters.length, 2);
  const ids = request.characters.map((c) => c.characterId);
  assert.ok(ids.includes(nova.characterId) && ids.includes(iris.characterId));

  // Per-character identity instructions are separate and character-specific
  const novaBlock = request.characters.find((c) => c.characterId === nova.characterId);
  const irisBlock = request.characters.find((c) => c.characterId === iris.characterId);
  assert.equal(novaBlock.identity.locked.hair, 'jet black');
  assert.equal(irisBlock.identity.locked.hair, 'auburn');
  assert.ok(novaBlock.identity.distinctness.includes(nova.characterId));
  assert.ok(irisBlock.identity.distinctness.includes(iris.characterId));
  assert.notDeepEqual(novaBlock.identity, irisBlock.identity);

  // Scene-level instructions live separately from character blocks
  assert.equal(request.scene.setting.location, 'rooftop bar at night');
  assert.equal(request.scene.composition.camera, 'medium shot, eye level');

  // Provenance records expected presence at exact versions
  assert.deepEqual(request.provenance.expectedCharacterIds.sort(), [nova.characterId, iris.characterId].sort());
  assert.equal(request.provenance.expectedCharacterVersions[nova.characterId], 1);
});

test('a multi-character scene is never reduced to one free-form prompt', async () => {
  const { scene, records } = await buildTwoCharacterScene();
  const request = compileImageRequest(scene, records);
  // No flattened prompt anywhere in the request shape
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'prompt'), false);
  for (const c of request.characters) {
    assert.equal(Object.prototype.hasOwnProperty.call(c, 'prompt'), false);
    assert.equal(typeof c.identity, 'object');
  }
  // Wardrobe stays per-character, never merged into scene text
  assert.equal(request.characters.find((c) => c.wardrobe === 'green dress').wardrobe, 'green dress');
});

test('compile refuses version mismatches between scene and loaded records', async () => {
  const { scene, records, nova } = await buildTwoCharacterScene();
  const tampered = { ...records, [nova.characterId]: { ...records[nova.characterId], version: 2 } };
  assert.throws(() => compileImageRequest(scene, tampered), /version mismatch/);
});

test('no runtime file imports test fixtures and no network calls exist in the scene layer', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const dir of ['apps', 'packages', 'db']) {
    for (const file of await listJs(path.join(root, dir))) {
      const src = await readFile(file, 'utf8');
      assert.ok(!/(?:from\s+|import\()\s*['"][^'"]*fixtures\//.test(src), `${file} imports test fixtures`);
    }
  }
  // The scene/request/validator layer makes no provider or network calls
  for (const rel of ['packages/character-core/scene.js', 'packages/character-core/reference-pack.js', 'packages/providers/image/image-request.js', 'packages/providers/image/image-validator.js']) {
    const src = await readFile(path.join(root, rel), 'utf8');
    assert.ok(!src.includes('fetch('), `${rel} must not make network calls`);
  }
});

async function listJs(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') out.push(...await listJs(p));
    else if (entry.isFile() && p.endsWith('.js')) out.push(p);
  }
  return out;
}
