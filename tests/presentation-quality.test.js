import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, validCharacter } from './helpers.js';
import { configuredChat, configuredImage, FixtureChatA, FixtureSceneImageProvider } from './fixtures/providers.js';
import { ScriptedImageValidator, ScriptedPresentationAssessor } from './fixtures/validators.js';
import { presentationReportTemplate, evaluatePresentationReport, computeFinalVerdict } from '../packages/providers/image/presentation-quality.js';

// Boot the full app with fixtures for provider, identity validator, and
// presentation assessor. No real network, no real models.
async function bootWorld({ assessor = null, galleryPolicy = {} } = {}) {
  const validator = new ScriptedImageValidator({ detections: [] });
  const app = await bootApp({
    chat: configuredChat(new FixtureChatA()),
    image: configuredImage(new FixtureSceneImageProvider()),
    imageValidator: validator,
    presentationAssessor: assessor,
    galleryPolicy,
  });
  const { tenantId } = await app.demo();
  const mk = async (name) => {
    const c = await app.call('POST', '/api/characters', { tenant: tenantId, body: validCharacter(name) });
    const ref = `asset://${name.toLowerCase()}-face-v1`;
    await app.call('POST', `/api/characters/${c.body.id}/references`, { tenant: tenantId, body: { version: 1, assets: [{ ref, kind: 'face' }] } });
    return { id: c.body.id, ref };
  };
  const a = await mk('Nova');
  const b = await mk('Iris');
  // Neutral adult editorial scene - tasteful, non-explicit
  const created = await app.call('POST', '/api/scenes', { tenant: tenantId, body: {
    characters: [
      { characterId: a.id, characterVersion: 1, sceneRole: 'left foreground', referenceAssets: [a.ref], appearanceLock: { hair: 'black' }, wardrobe: 'evening cocktail dress', poseAction: 'standing at the gallery opening', consent: { fictionalAdult: true, age: 25 } },
      { characterId: b.id, characterVersion: 1, sceneRole: 'right foreground', referenceAssets: [b.ref], appearanceLock: { hair: 'auburn' }, wardrobe: 'tailored suit', poseAction: 'holding a champagne glass', consent: { fictionalAdult: true, age: 25 } },
    ],
    setting: { location: 'art gallery opening, evening editorial' },
    composition: { camera: 'medium two-shot', lighting: 'warm gallery lighting' },
  } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const sceneId = created.body.id;
  // generate + pass identity
  await app.call('POST', `/api/scenes/${sceneId}/generate`, { tenant: tenantId });
  validator.detections = [
    { characterId: a.id, identityScore: 0.95 },
    { characterId: b.id, identityScore: 0.92 },
  ];
  const idv = await app.call('POST', `/api/scenes/${sceneId}/validate`, { tenant: tenantId });
  assert.equal(idv.status, 200);
  return { app, tenantId, sceneId, a, b };
}

test('adult editorial scene is accepted; identity passes; four axes reported distinctly', async () => {
  const { app, tenantId, sceneId } = await bootWorld();
  try {
    const v = await app.call('GET', `/api/scenes/${sceneId}/verdict`, { tenant: tenantId });
    assert.equal(v.body.axes.identity, 'passed');
    assert.equal(v.body.axes.technical, 'ok');
    assert.equal(v.body.axes.presentation, 'not assessed');
    assert.equal(v.body.axes.humanApproval, 'not approved');
  } finally { await app.close(); }
});

test('identity passes but visual appeal fails: verdict visually_weak, publication blocked', async () => {
  const assessor = new ScriptedPresentationAssessor({ visualAppealScore: 0.3, compositionScore: 0.8, poseNaturalness: 0.8, cropFramingQuality: 0.8 });
  const { app, tenantId, sceneId } = await bootWorld({ assessor });
  try {
    const p = await app.call('POST', `/api/scenes/${sceneId}/presentation`, { tenant: tenantId });
    assert.equal(p.body.presentation.verdict, 'visually_weak');
    assert.equal(p.body.finalVerdict, 'visually_weak');
    const pub = await app.call('POST', `/api/scenes/${sceneId}/publish`, { tenant: tenantId });
    assert.equal(pub.status, 409);
    assert.equal(pub.body.verdict, 'visually_weak');
  } finally { await app.close(); }
});

test('seam, background-leakage, awkward-pose, and low-composition signals are recorded as warnings', async () => {
  const assessor = new ScriptedPresentationAssessor({
    visualAppealScore: 0.8, compositionScore: 0.4, poseNaturalness: 0.3, cropFramingQuality: 0.8,
    seamVisibility: 'high', backgroundLeakage: 'high', anatomyArtifactWarnings: ['hand artifact left subject'],
  });
  const { app, tenantId, sceneId } = await bootWorld({ assessor });
  try {
    const p = await app.call('POST', `/api/scenes/${sceneId}/presentation`, { tenant: tenantId });
    assert.equal(p.body.presentation.verdict, 'visually_weak');
    const w = p.body.presentation.warnings;
    assert.ok(w.includes('seam visibility high'));
    assert.ok(w.includes('background leakage high'));
    assert.ok(w.includes('awkward pose'));
    assert.ok(w.includes('hand artifact left subject'));
    assert.ok(p.body.presentation.reasons.some((r) => r.includes('compositionScore')));
  } finally { await app.close(); }
});

test('identity + presentation approval publishes; human-approval gate blocks until approved', async () => {
  const good = { visualAppealScore: 0.9, compositionScore: 0.9, poseNaturalness: 0.9, cropFramingQuality: 0.9, commercialReadiness: 'ready' };

  // Without human-approval requirement: presentation_ready publishes directly
  const w1 = await bootWorld({ assessor: new ScriptedPresentationAssessor(good) });
  try {
    const p = await w1.app.call('POST', `/api/scenes/${w1.sceneId}/presentation`, { tenant: w1.tenantId });
    assert.equal(p.body.finalVerdict, 'approved_for_gallery');
    const pub = await w1.app.call('POST', `/api/scenes/${w1.sceneId}/publish`, { tenant: w1.tenantId });
    assert.equal(pub.status, 201);
    assert.equal(pub.body.asset.provenance.finalVerdict, 'approved_for_gallery');
  } finally { await w1.app.close(); }

  // With requireHumanApproval: blocked at needs_human_review until approved
  const w2 = await bootWorld({ assessor: new ScriptedPresentationAssessor(good), galleryPolicy: { requireHumanApproval: true } });
  try {
    await w2.app.call('POST', `/api/scenes/${w2.sceneId}/presentation`, { tenant: w2.tenantId });
    const blocked = await w2.app.call('POST', `/api/scenes/${w2.sceneId}/publish`, { tenant: w2.tenantId });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.verdict, 'needs_human_review');
    await w2.app.call('POST', `/api/scenes/${w2.sceneId}/approve`, { tenant: w2.tenantId, body: { approvedBy: 'Trey' } });
    const pub = await w2.app.call('POST', `/api/scenes/${w2.sceneId}/publish`, { tenant: w2.tenantId });
    assert.equal(pub.status, 201);
    assert.equal(pub.body.asset.provenance.humanApproval.approvedBy, 'Trey');
  } finally { await w2.app.close(); }
});

test('honest states: no assessor -> 503; report demanding human review -> needs_human_review', async () => {
  const { app, tenantId, sceneId } = await bootWorld();
  try {
    const none = await app.call('POST', `/api/scenes/${sceneId}/presentation`, { tenant: tenantId });
    assert.equal(none.status, 503);
    assert.match(none.body.error, /no presentation-quality assessor/);
  } finally { await app.close(); }

  const humanFlag = new ScriptedPresentationAssessor({ humanReviewRequired: true });
  const w = await bootWorld({ assessor: humanFlag });
  try {
    const p = await w.app.call('POST', `/api/scenes/${w.sceneId}/presentation`, { tenant: w.tenantId });
    assert.equal(p.body.presentation.verdict, 'needs_human_review');
    const pub = await w.app.call('POST', `/api/scenes/${w.sceneId}/publish`, { tenant: w.tenantId });
    assert.equal(pub.status, 409);
  } finally { await w.app.close(); }
});

test('verdict unit rules: rejected_identity and rejected_technical dominate', () => {
  assert.equal(computeFinalVerdict({ identityStatus: 'failed', technicalOk: true, presentation: null, humanApproval: null, requireHumanApproval: false }), 'rejected_identity');
  assert.equal(computeFinalVerdict({ identityStatus: 'passed', technicalOk: false, presentation: null, humanApproval: null, requireHumanApproval: false }), 'rejected_technical');
  const weak = evaluatePresentationReport({ ...presentationReportTemplate(), humanReviewRequired: false, visualAppealScore: 0.1 });
  assert.equal(weak.verdict, 'visually_weak');
  assert.equal(computeFinalVerdict({ identityStatus: 'passed', technicalOk: true, presentation: weak, humanApproval: { approved: true, approvedBy: 'Trey' }, requireHumanApproval: true }), 'approved_for_gallery');
});
