import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ComfyUIImageProvider, comfyuiTuningDefaults } from '../packages/providers/image/comfyui.js';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'benchmark-regression.json');

test('adapter defaults match the benchmark-winning configuration', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  for (const [key, value] of Object.entries(fixture.winner)) {
    assert.equal(comfyuiTuningDefaults[key], value, `comfyuiTuningDefaults.${key} drifted from benchmark winner`);
  }
});

test('canonical benchmark workflow hash is stable (deliberate-change tripwire)', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const p = new ComfyUIImageProvider('http://fixture.invalid:0');
  const request = {
    kind: 'multi-character-image-request',
    sceneId: fixture.canonicalRequest.sceneId,
    tenantId: 'bench',
    scene: { setting: { location: 'sunlit park, afternoon' }, composition: { camera: 'medium two-shot, eye level', lighting: 'natural light' }, relationships: [] },
    characters: [
      { characterId: 'refA', characterVersion: 1, sceneRole: 'left foreground', referenceAssets: ['asset://refA'], wardrobe: 'dark jacket', identityLock: true, identity: { gender: 'female' } },
      { characterId: 'refB', characterVersion: 1, sceneRole: 'right foreground', referenceAssets: ['asset://refB'], wardrobe: 'olive blouse', identityLock: true, identity: { gender: 'female' } },
    ],
    provenance: { expectedCharacterIds: ['refA', 'refB'] },
  };
  const { workflow, seed } = p.buildSceneWorkflow(request, { seed: fixture.canonicalRequest.seed });
  assert.equal(seed, fixture.canonicalRequest.seed);
  const hash = createHash('sha256').update(JSON.stringify(workflow)).digest('hex');
  assert.equal(hash, fixture.canonicalRequest.workflowHash,
    'workflow builder output drifted from the benchmarked baseline - if intentional, re-benchmark and update the fixture with a receipt');
});
