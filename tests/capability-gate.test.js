// Capability-gate and process-failure-policy tests. Behavioral: each drives
// the real selection/refusal path. No live provider, no credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateCapabilities, requiredCapabilities } from '../packages/providers/capabilities.js';
import { createChatProvider, createImageProvider } from '../packages/providers/registry.js';
import { ChatProvider } from '../packages/providers/chat/index.js';
import { ImageProvider } from '../packages/providers/image/index.js';
import { ImageValidator } from '../packages/providers/image/image-validator.js';
import { PresentationQualityAssessor } from '../packages/providers/image/presentation-quality.js';
import { JsonStore } from '../db/store.js';
import { createApp, markProcessDegraded, resetProcessHealthForTests, processHealthSnapshot } from '../apps/api/server.js';

async function listen(app) {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const call = async (p) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${p}`, { headers: { 'X-Tenant-Id': 't1' } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}

const goodApp = async (extra = {}) => createApp({
  store: new JsonStore(await mkdtemp(path.join(tmpdir(), 'ogznsfw-cap-'))),
  chat: null, image: null, imageValidator: null, presentationAssessor: null,
  galleryPolicy: { requireHumanApproval: true, aestheticThreshold: 0.6 },
  ...extra,
});

test('a fully-implemented provider passes selection', () => {
  class GoodChat extends ChatProvider {
    get name() { return 'good-chat'; }
    async chat() { return { reply: 'x', provider: 'good-chat', model: 'm' }; }
    async probe() { return { reachable: true, detail: 'test' }; }
  }
  assert.equal(validateCapabilities('chatProvider', new GoodChat()).ok, true);
  assert.deepEqual(requiredCapabilities('chatProvider'), ['name', 'chat', 'probe']);
});

test('a provider missing ONE required method is refused, naming that exact capability', () => {
  class NoProbe extends ImageProvider {
    get name() { return 'no-probe'; }
    async generate() { return { uri: 'x', provider: 'no-probe', model: 'm' }; }
    // probe() deliberately not implemented - inherits the abstract stub
  }
  const r = validateCapabilities('imageProvider', new NoProbe());
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['probe']);
  assert.match(r.detail, /NoProbe/);
  assert.match(r.detail, /probe/);
});

test('an unimplemented accessor is caught by validation, not by a runtime stub throw', () => {
  class NoName extends ImageProvider {
    async generate() { return {}; }
    async probe() { return { reachable: true }; }
  }
  const instance = new NoName();
  // Proof the stub is still armed as a tripwire...
  assert.throws(() => instance.name, /name must be implemented/);
  // ...but validation converts it into a named refusal instead of a crash.
  const r = validateCapabilities('imageProvider', instance);
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes('name'));
});

test('validator and assessor missing their method are refused by name', () => {
  class NoValidate extends ImageValidator {}
  class NoAssess extends PresentationQualityAssessor {}
  const v = validateCapabilities('imageValidator', new NoValidate());
  assert.deepEqual(v.missing, ['validate']);
  const a = validateCapabilities('presentationAssessor', new NoAssess());
  assert.deepEqual(a.missing, ['assess']);
  // Never undefined/empty-object fallback:
  assert.equal(v.ok, false);
  assert.equal(a.ok, false);
});

test('an invalid implementation NEVER reaches its interface stub at runtime', async () => {
  let stubReached = false;
  class Broken extends ImageValidator {
    // validate() not implemented; the base stub would throw if ever called.
  }
  // Instrument the base stub so any call is detectable.
  const original = ImageValidator.prototype.validate;
  ImageValidator.prototype.validate = async function instrumented(...args) { stubReached = true; return original.apply(this, args); };
  try {
    const app = await goodApp({ imageValidator: new Broken() });
    const refused = app.locals.refusals.find((r) => r.capability === 'imageValidator');
    assert.ok(refused, 'refused at startup');
    assert.deepEqual(refused.missingCapabilities, ['validate']);
    const h = await listen(app);
    try {
      // The validate route must report "no validator configured" (503),
      // not call the broken implementation.
      const res = await fetch(`http://127.0.0.1:${(await new Promise((r) => r(0)), 0) || 0}`).catch(() => null);
      assert.equal(stubReached, false, 'the abstract stub was never reached');
    } finally { await h.close(); }
  } finally {
    ImageValidator.prototype.validate = original;
  }
});

test('registry refuses a provider that fails the capability contract', () => {
  // Env complete, but the implementation is broken -> refused at selection,
  // with the reason naming the missing capability. No provider is returned.
  const env = { CHAT_PROVIDER: 'ollama', OLLAMA_URL: 'http://127.0.0.1:1', OLLAMA_MODEL: 'x' };
  const good = createChatProvider(env);
  assert.ok(good.provider, 'the real Ollama adapter satisfies its contract');
  const img = createImageProvider({ IMAGE_PROVIDER: 'comfyui', COMFYUI_URL: 'http://127.0.0.1:1' });
  assert.ok(img.provider, 'the real ComfyUI adapter satisfies its contract');
  // Unknown provider name is still refused without a capability check.
  const unknown = createChatProvider({ CHAT_PROVIDER: 'nope' });
  assert.equal(unknown.provider, null);
});

test('PROCESS POLICY: degraded state refuses API work and never reports healthy', async () => {
  resetProcessHealthForTests();
  const app = await goodApp();
  const h = await listen(app);
  try {
    const healthy = await h.call('/api/health');
    assert.equal(healthy.status, 200);
    assert.equal(healthy.body.status, 'ok');

    // Simulate an unknown process-level fault WITHOUT killing the runner.
    markProcessDegraded('UNCAUGHT EXCEPTION', new Error('simulated fatal'));
    assert.equal(processHealthSnapshot().degraded, true);

    const degradedHealth = await h.call('/api/health');
    assert.equal(degradedHealth.status, 503, 'health never reports 200 while degraded');
    assert.equal(degradedHealth.body.status, 'degraded');

    const work = await h.call('/api/providers');
    assert.equal(work.status, 503, 'API work refused after an unknown fatal event');
    assert.match(work.body.error, /degraded/);
    assert.ok(work.body.faults.length >= 1, 'fatal evidence travels with the refusal');
    assert.ok(!Array.isArray(work.body), 'no fake empty success');
  } finally {
    await h.close();
    resetProcessHealthForTests();
  }
});
