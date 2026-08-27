import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditManifest } from '../training/audit-dataset.mjs';
import { characterLoraRef, validateLoraProvenance, loraUsableForPublication } from '../packages/generation/lora.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function img(overrides = {}) {
  return {
    path: `img-${Math.abs(overrides.n ?? 0)}.png`,
    sha256: String(overrides.n ?? 0).padStart(64, 'a').slice(0, 64),
    caption: 'novaident woman, dark jacket, park background, natural light',
    split: 'training',
    resolution: { width: 1024, height: 1024 },
    source: { kind: 'generated-local', licensing: 'owned' },
    approval: { status: 'approved', approvedBy: 'Trey', at: '2026-08-18T00:00:00Z' },
    ...overrides,
  };
}

function manifest(images) {
  return { tenantId: 't1', characterId: 'nova', characterVersion: 1, specHash: 'x'.repeat(8), captionPolicy: 'trigger-plus-variables', triggerToken: 'novaident', images };
}

test('character specs are valid, distinguish invariant vs scene-dependent, and are fictional adults', async () => {
  for (const name of ['nova', 'iris']) {
    const spec = JSON.parse(await readFile(path.join(ROOT, 'training', 'characters', `${name}.spec.json`), 'utf8'));
    assert.equal(spec.consent.fictionalAdult, true);
    assert.ok(spec.consent.age >= 18);
    assert.equal(spec.consent.basedOnRealPerson, false);
    assert.ok(spec.invariantIdentity.hair && spec.invariantIdentity.eyes);
    assert.ok(spec.sceneDependent.wardrobe.includes('not identity'));
    assert.ok(spec.forbiddenIdentityDrift.length >= 3);
    assert.ok(spec.referencePackRequirements.minimumApprovedImages >= 16);
    assert.equal(spec.specStatus, 'approved-by-Trey', 'canon specs approved 2026-08-18');
    assert.ok(spec.approval?.approvedBy === 'Trey' && spec.approval?.at, 'approval must carry approver and timestamp');
    assert.ok(spec.triggerToken === `${name}ident`, 'trigger token lives in the canonical spec');
  }
});

test('dataset audit: ready only with enough approved, disjoint, licensed, trigger-captioned images', () => {
  const training = Array.from({ length: 16 }, (_, n) => img({ n: n + 10 }));
  const evaluation = Array.from({ length: 6 }, (_, n) => img({ n: n + 100, split: 'evaluation' }));
  const good = auditManifest(manifest([...training, ...evaluation]));
  assert.equal(good.ready, true, JSON.stringify(good.errors));

  // duplicate hash rejected
  const dup = auditManifest(manifest([...training, img({ n: 10, path: 'copy.png' }), ...evaluation]));
  assert.ok(dup.errors.some((e) => e.includes('duplicate image hash')));

  // unresolved approval blocks readiness
  const pending = auditManifest(manifest([...training.slice(0, 15), img({ n: 99, approval: { status: 'pending' } }), ...evaluation]));
  assert.equal(pending.ready, false);

  // unclear licensing cannot be approved
  const unclear = auditManifest(manifest([...training.slice(0, 15), img({ n: 98, source: { kind: 'other', licensing: 'unclear' } }), ...evaluation]));
  assert.ok(unclear.errors.some((e) => e.includes('unclear licensing')));

  // rejection requires a reason
  const noReason = auditManifest(manifest([...training, img({ n: 97, approval: { status: 'rejected' } }), ...evaluation]));
  assert.ok(noReason.errors.some((e) => e.includes('rejectedReason')));

  // eval/training splits must be disjoint
  const overlap = auditManifest(manifest([...training, img({ n: 10, path: 'same.png', split: 'evaluation' })]));
  assert.ok(overlap.errors.some((e) => e.includes('also appears in training')));

  // caption must contain the trigger token
  const noTrigger = auditManifest(manifest([...training.slice(0, 15), img({ n: 96, caption: 'a woman in a jacket' }), ...evaluation]));
  assert.ok(noTrigger.errors.some((e) => e.includes('trigger token')));

  // insufficient counts
  const thin = auditManifest(manifest([img({ n: 1 }), img({ n: 2, split: 'evaluation' })]));
  assert.ok(thin.errors.some((e) => e.includes('at least 16')));
});

test('LoRA refs and provenance: required fields enforced; publication gated on full validation', () => {
  const ref = characterLoraRef({ loraId: 'nova-identity', characterId: 'nova', characterVersion: 1, revision: 1, fileHash: 'a'.repeat(64), triggerToken: 'novaident', baseModelHash: 'b'.repeat(64) });
  assert.equal(ref.loraId, 'nova-identity');
  assert.throws(() => characterLoraRef({ loraId: 'x' }), /required/);

  const record = {
    loraId: 'nova-identity', characterId: 'nova', characterVersion: 1, revision: 1, fileHash: 'a'.repeat(64),
    baseModel: { checkpoint: 'sd_xl_base_1.0.safetensors', sha256: 'c'.repeat(64), license: 'CreativeML Open RAIL++-M' },
    datasetManifestHash: 'd'.repeat(64),
    training: { tool: 'kohya-ss/sd-scripts', rank: 16, learningRate: 1e-4, steps: 2000, resolution: 1024, seed: 42 },
    validation: { status: 'not-run' },
  };
  assert.equal(validateLoraProvenance(record).valid, true);
  assert.equal(loraUsableForPublication(record), false, 'not-run cannot publish');
  assert.equal(loraUsableForPublication({ ...record, validation: { status: 'in-review' } }), false, 'one good image is not enough');
  assert.equal(loraUsableForPublication({ ...record, validation: { status: 'passed' } }), true);
  const bad = validateLoraProvenance({ ...record, training: { tool: 'x' } });
  assert.equal(bad.valid, false);
});
