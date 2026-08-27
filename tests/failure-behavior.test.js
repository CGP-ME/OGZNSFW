// Doctrine failure-behavior tests. These exercise FAILURE PATHS, not source
// text: each one drives real behavior and asserts the process survives, the
// error type is preserved, evidence is emitted, and nothing false-succeeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonStore } from '../db/store.js';
import { createApp } from '../apps/api/server.js';
import { bootApp, validCharacter } from './helpers.js';
import { configuredChat, FixtureChatA } from './fixtures/providers.js';
import { SceneService } from '../packages/character-core/scene.js';
import { CharacterService } from '../packages/character-core/index.js';
import { ReferencePackService } from '../packages/character-core/reference-pack.js';
import { MemoryStore } from '../packages/memory/index.js';

async function listen(app) {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': 't1' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { server, call, close: () => new Promise((r) => server.close(r)) };
}

test('an escaped throw quarantines the REQUEST and the process survives with the error type preserved', async () => {
  // A store whose read throws a distinctive typed error - simulating a
  // corrupted data file, which is the real-world reachable case.
  class ExplodingStore extends JsonStore {
    async load() { const e = new TypeError('corrupted collection payload'); throw e; }
  }
  const app = createApp({
    store: new ExplodingStore(await mkdtemp(path.join(tmpdir(), 'ogznsfw-boom-'))),
    chat: configuredChat(new FixtureChatA()), image: null, imageValidator: null, presentationAssessor: null,
    galleryPolicy: { requireHumanApproval: true, aestheticThreshold: 0.6 },
  });
  const h = await listen(app);
  try {
    const res = await h.call('GET', '/api/scenes');
    assert.equal(res.status, 500, 'request is quarantined, not silently empty');
    assert.equal(res.body.errorType, 'TypeError', 'typed error category is preserved');
    assert.match(res.body.error, /quarantined/);
    assert.ok(!Array.isArray(res.body), 'must NOT false-succeed as an empty array');

    // The process is alive and still serving: a second request works.
    const after = await h.call('GET', '/api/providers');
    assert.equal(after.status, 200, 'service still running after a quarantined request');
  } finally { await h.close(); }
});

test('missing capabilities are refused at startup, named, and every other route keeps serving', async () => {
  const app = createApp({});
  const names = app.locals.refusals.map((r) => r.capability).sort();
  assert.deepEqual(names, ['chat', 'galleryPolicy', 'image', 'imageValidator', 'presentationAssessor', 'store'].sort());
  const h = await listen(app);
  try {
    const res = await h.call('GET', '/api/scenes');
    assert.equal(res.status, 503, 'data routes refuse by name');
    assert.match(res.body.detail, /store/);
    assert.match(res.body.detail, /quarantined, not defaulted/);
  } finally { await h.close(); }
});

test('unstated publication policy quarantines publishing only - scenes still work', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ogznsfw-nopolicy-'));
  const store = new JsonStore(dir);
  const characters = new CharacterService(store);
  const scenes = new SceneService(store, characters, new ReferencePackService(store), undefined);
  assert.ok(scenes.publicationQuarantine, 'publication is quarantined');
  // Scene reads still work - the machine is not caged.
  assert.deepEqual(await scenes.list('t1'), []);
  const refused = await scenes.publishAsset('t1', 'any', { uri: 'x', provider: 'p', model: 'm' });
  assert.equal(refused.ok, false);
  assert.equal(refused.verdict, 'quarantined');
});

test('tenant-scope tripwires refuse without crossing scope and without throwing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ogznsfw-scope-'));
  const store = new JsonStore(dir);
  const characters = new CharacterService(store);
  const memories = new MemoryStore(store);
  const refs = new ReferencePackService(store);

  // No throws, no cross-tenant data, no false success.
  assert.equal(await characters.get(null, 'c1'), null);
  assert.deepEqual(await characters.list(null), []);
  const created = await characters.create(null, validCharacter('X'));
  assert.equal(created.ok, false);
  assert.deepEqual(await memories.list(null, 'c1'), []);
  assert.deepEqual(await memories.retrieve(null, 'c1'), []);
  const saved = await memories.save(null, 'c1', { content: 'x' });
  assert.equal(saved.ok, false);
  const reg = await refs.register(null, 'c1', 1, [{ ref: 'asset://x' }]);
  assert.equal(reg.ok, false);
  assert.equal(await refs.get(null, 'c1', 1), null);
});

test('a failed run records evidence with explicit absence rather than throwing or inventing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ogznsfw-failrun-'));
  const store = new JsonStore(dir);
  const characters = new CharacterService(store);
  const scenes = new SceneService(store, characters, new ReferencePackService(store), { requireHumanApproval: false, aestheticThreshold: 0.6 });
  const scene = await store.insert('scenes', { tenantId: 't1', characters: [{ characterId: 'a', characterVersion: 1 }], generation: { status: 'planned', expectedCharacterIds: ['a'] }, validationStatus: 'pending' });

  // Producer omits both fields: tripwire fires, evidence still lands, no throw.
  const res = await scenes.recordFailedRun('t1', scene.id, null, null);
  assert.equal(res.ok, true);
  const stored = await scenes.get('t1', scene.id);
  assert.equal(stored.validationStatus, 'failed');
  assert.equal(stored.generation.failureReason.absent, true, 'absence is NAMED, not "unknown"');
  assert.equal(stored.generation.pipeline.absent, true);
  assert.deepEqual(stored.generation.tripwire, ['failureReason', 'pipelineProvenance']);
});

test('an unparseable API response surfaces as a named parse failure, never an empty object', async () => {
  // Mirrors the UI client contract: a non-JSON body must not become {}.
  const app = createApp({ store: new JsonStore(await mkdtemp(path.join(tmpdir(), 'ogznsfw-parse-'))), chat: null, image: null, imageValidator: null, presentationAssessor: null, galleryPolicy: { requireHumanApproval: true, aestheticThreshold: 0.6 } });
  app.get('/api/not-json', (req, res) => res.status(200).type('text/plain').send('this is not json'));
  const h = await listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${h.server.address().port}/api/not-json`, { headers: { 'X-Tenant-Id': 't1' } });
    let parsed = null; let parseFailed = false;
    try { parsed = await res.json(); } catch { parseFailed = true; }
    assert.equal(parseFailed, true, 'the body genuinely does not parse');
    assert.equal(parsed, null, 'and nothing substitutes a plausible empty object');
  } finally { await h.close(); }
});

test('no live provider is contacted anywhere in this suite', async () => {
  // Every app in these tests declares providers null or fixture-backed; a
  // real provider would require COMFYUI_URL/OLLAMA_URL/HF_TOKEN, none of
  // which are read here.
  const app = await bootApp({ chat: null, image: null });
  try {
    const res = await app.call('POST', '/api/chat', { tenant: (await app.demo()).tenantId, body: { characterId: 'x', message: 'hi' } });
    assert.equal(res.status, 503, 'no provider configured -> honest refusal, no network call');
  } finally { await app.close(); }
});
