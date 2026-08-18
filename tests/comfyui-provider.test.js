import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComfyUIImageProvider, seedFromSceneId, comfyuiTuningDefaults } from '../packages/providers/image/comfyui.js';
import { FakeComfyClient } from './fixtures/comfy-client.js';

function provider(failMode, tuning = {}) {
  const client = new FakeComfyClient({ failMode });
  const p = new ComfyUIImageProvider('http://fixture.invalid:0', { client, tuning: { pollIntervalMs: 1, timeoutMs: 2000, ...tuning } });
  return { p, client };
}

function sceneRequest(characterCount = 2) {
  const chars = [];
  for (let i = 0; i < characterCount; i++) {
    chars.push({
      characterId: `char-${i}`,
      characterVersion: i + 1,
      sceneRole: i === 0 ? 'left foreground' : 'right foreground',
      identity: { locked: { hair: i === 0 ? 'black' : 'auburn' } },
      wardrobe: i === 0 ? 'leather jacket' : 'green dress',
      poseAction: 'standing',
      referenceAssets: [`asset://ref${i}`],
      identityLock: true,
    });
  }
  return {
    kind: 'multi-character-image-request',
    sceneId: 'scene-test-1',
    tenantId: 'tenant-a',
    scene: { setting: { location: 'sunlit park' }, composition: { camera: 'two-shot' }, relationships: [] },
    characters: chars,
    provenance: { expectedCharacterIds: chars.map((c) => c.characterId) },
  };
}

test('unreachable ComfyUI refuses clearly, never claims success', async () => {
  const { p } = provider('unreachable');
  const probe = await p.probe();
  assert.equal(probe.reachable, false);
  await assert.rejects(() => p.generateFromScene(sceneRequest()), /unreachable/);
});

test('malformed scene requests are rejected before any network activity', async () => {
  const { p, client } = provider(null);
  await assert.rejects(() => p.generateFromScene({ kind: 'nope' }), /malformed/);
  await assert.rejects(() => p.generateFromScene({ kind: 'multi-character-image-request', characters: [] }), /malformed/);
  assert.equal(client.postedWorkflows.length, 0);
});

test('one-character request builds a single reference chain and succeeds', async () => {
  const { p, client } = provider(null);
  const result = await p.generateFromScene(sceneRequest(1));
  assert.equal(result.provider, 'comfyui');
  assert.match(result.uri, /^data:image\/png;base64,/);
  const wf = client.postedWorkflows[0];
  const loadImages = Object.values(wf).filter((n) => n.class_type === 'LoadImage');
  const adapters = Object.values(wf).filter((n) => n.class_type === 'IPAdapterAdvanced');
  assert.equal(loadImages.length, 1);
  assert.equal(adapters.length, 1);
  assert.equal(loadImages[0].inputs.image, 'ref0.png');
});

test('two-character request preserves separate reference conditioning per character', async () => {
  const { p, client } = provider(null);
  await p.generateFromScene(sceneRequest(2));
  const wf = client.postedWorkflows[0];
  const loadImages = Object.values(wf).filter((n) => n.class_type === 'LoadImage').map((n) => n.inputs.image).sort();
  assert.deepEqual(loadImages, ['ref0.png', 'ref1.png']);
  const adapters = Object.values(wf).filter((n) => n.class_type === 'IPAdapterAdvanced');
  assert.equal(adapters.length, 2, 'one IPAdapter chain per character');
  // Default: NO region-masked character text (benchmark evidence: masked
  // char-text drives merges; wardrobe transfers via references). Character
  // separation is carried by per-character reference chains + masks.
  const charTexts = Object.values(wf).filter((n) => n.class_type === 'CLIPTextEncode').map((n) => n.inputs.text);
  assert.equal(Object.values(wf).filter((n) => n.class_type === 'ConditioningSetMask').length, 0, 'no masked char-text by default');
  assert.ok(!charTexts.some((t) => t.includes('leather jacket') || t.includes('green dress')), 'wardrobe words never leak into text by default');
  // Scene text carries setting only
  assert.ok(charTexts.some((t) => t.includes('sunlit park')));

  // Experimental opt-in: characterTextStrength > 0 emits separate
  // region-masked per-character text, never merged across characters.
  const { p: pOn, client: clientOn } = provider(null, { characterTextStrength: 1.0 });
  await pOn.generateFromScene(sceneRequest(2));
  const wfOn = clientOn.postedWorkflows[0];
  const onTexts = Object.values(wfOn).filter((n) => n.class_type === 'CLIPTextEncode').map((n) => n.inputs.text);
  assert.equal(Object.values(wfOn).filter((n) => n.class_type === 'ConditioningSetMask').length, 2, 'opt-in emits per-character masked conditioning');
  assert.ok(onTexts.some((t) => t.includes('leather jacket') && !t.includes('green dress')), 'character texts are not merged');
  assert.ok(onTexts.some((t) => t.includes('green dress') && !t.includes('leather jacket')), 'character texts are not merged');
  assert.ok(!onTexts.some((t) => t.includes('leather jacket') && t.includes('green dress')), 'no flattened character prompt');
});

test('workflow hash, seed, and provenance are recorded deterministically', async () => {
  const { p } = provider(null);
  const r1 = await p.generateFromScene(sceneRequest(2));
  assert.equal(typeof r1.provenance.workflowHash, 'string');
  assert.equal(r1.provenance.workflowHash.length, 64);
  assert.equal(r1.provenance.seed, seedFromSceneId('scene-test-1'));
  assert.equal(r1.provenance.checkpoint, comfyuiTuningDefaults.checkpoint);
  assert.deepEqual(r1.provenance.characterVersions, { 'char-0': 1, 'char-1': 2 });
  assert.deepEqual(r1.provenance.referenceAssets, ['asset://ref0', 'asset://ref1']);
  assert.equal(r1.provenance.comfyuiVersion, '0.33.1-test');
  // Same scene id -> same seed and same workflow hash (determinism)
  const { p: p2 } = provider(null);
  const r2 = await p2.generateFromScene(sceneRequest(2));
  assert.equal(r2.provenance.workflowHash, r1.provenance.workflowHash);
});

test('queue rejection, missing prompt id, execution error, missing output, and empty bytes all fail loudly', async () => {
  await assert.rejects(() => provider('reject').p.generateFromScene(sceneRequest(1)), /rejected the workflow/);
  await assert.rejects(() => provider('no-id').p.generateFromScene(sceneRequest(1)), /did not return a prompt_id/);
  await assert.rejects(() => provider('exec-error').p.generateFromScene(sceneRequest(1)), /execution failed/);
  await assert.rejects(() => provider('no-output').p.generateFromScene(sceneRequest(1)), /no output images/);
  await assert.rejects(() => provider('empty-bytes').p.generateFromScene(sceneRequest(1)), /empty bytes/);
});

test('tuning hooks flow into the workflow', async () => {
  const { p, client } = provider(null, { maskFeather: 0, maskOverlap: 0, adapterWeight: 0.5, adapterWeightType: 'style transfer', steps: 12, cfg: 4.5, width: 512, height: 512, seed: 99 });
  await p.generateFromScene(sceneRequest(2));
  const wf = client.postedWorkflows[0];
  const feather = Object.values(wf).filter((n) => n.class_type === 'FeatherMask');
  assert.equal(feather.length, 0, 'feather 0 emits no FeatherMask nodes');
  const adapters = Object.values(wf).filter((n) => n.class_type === 'IPAdapterAdvanced');
  assert.ok(adapters.every((a) => a.inputs.weight === 0.5 && a.inputs.weight_type === 'style transfer'));
  const ks = Object.values(wf).find((n) => n.class_type === 'KSampler');
  assert.equal(ks.inputs.steps, 12);
  assert.equal(ks.inputs.cfg, 4.5);
  assert.equal(ks.inputs.seed, 99);
});
