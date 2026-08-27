// Retention-rubric and memory-feedback tests. importance = retention
// priority (never claimed as emotional understanding); confidence is a
// separate value; every score carries its reason; failures are named, never
// reported as success.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeuristicMemoryExtractor, MemoryStore, classifyRetention, RETENTION_RUBRIC } from '../packages/memory/index.js';
import { JsonStore } from '../db/store.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { bootApp, validCharacter } from './helpers.js';
import { configuredChat, FixtureChatA } from './fixtures/providers.js';

const extractor = new HeuristicMemoryExtractor();

test('explicit remember request receives high importance (4) with its reason', async () => {
  const found = await extractor.extract('Remember that I am vegetarian.');
  const fact = found.find((f) => f.kind === 'explicit-fact');
  assert.ok(fact);
  assert.equal(fact.importance, 4);
  assert.equal(fact.importanceReason, 'explicit remember request');
  assert.equal(fact.sourceType, 'chat-extraction-heuristic');
});

test('major boundary receives importance 5', async () => {
  for (const msg of ["Never bring up my ex again.", "That's a hard boundary."]) {
    const found = await extractor.extract(msg);
    const b = found.find((f) => f.kind === 'boundary');
    assert.ok(b, `boundary extracted from: ${msg}`);
    assert.equal(b.importance, 5);
    assert.match(b.importanceReason, /boundary or safety/);
  }
});

test('durable identity fact receives 4; preference receives 3; casual receives low', async () => {
  const name = (await extractor.extract('my name is Ash')).find((f) => f.kind === 'identity');
  assert.equal(name.importance, 4);
  const pref = (await extractor.extract('I like the city right after rain.')).find((f) => f.kind === 'preference');
  assert.equal(pref.importance, 3);
  const casual = (await extractor.extract("I'm craving ramen tonight.")).find((f) => f.kind === 'casual');
  assert.ok(casual.importance <= 2, 'casual statement scores low retention');
});

test('importance and confidence are separate values; rubric text exists for every level', () => {
  const c = classifyRetention('preference');
  assert.notEqual(c.importance, c.confidence);
  assert.equal(typeof c.importance, 'number');
  assert.equal(typeof c.confidence, 'number');
  for (const level of [1, 2, 3, 4, 5]) assert.ok(RETENTION_RUBRIC[level]);
  // Unclassifiable content: named baseline, confidence null - no fake score
  // presented as understanding.
  const u = classifyRetention('mystery-kind');
  assert.match(u.importanceReason, /unclassified/);
  assert.equal(u.confidence, null);
});

test('store persists reason/confidence/sourceType and refuses bare or unreasoned scores', async () => {
  const store = new MemoryStore(new JsonStore(await mkdtemp(path.join(tmpdir(), 'mem-'))));
  const saved = await store.save('t1', 'c1', { kind: 'identity', content: "User's name is Ash", importance: 4, importanceReason: 'identity fact stated by the user', confidence: 0.9, sourceType: 'chat-extraction-heuristic' });
  assert.equal(saved.importance, 4);
  assert.equal(saved.importanceReason, 'identity fact stated by the user');
  assert.equal(saved.confidence, 0.9);
  assert.equal(saved.sourceType, 'chat-extraction-heuristic');
  assert.equal(saved.retention, 'active');

  // importance without a reason: refused, not silently accepted
  const bare = await store.save('t1', 'c1', { content: 'x', importance: 4, sourceType: 'manual' });
  assert.equal(bare.ok, false);
  // no sourceType: refused - every memory names where it came from
  const noSource = await store.save('t1', 'c1', { content: 'x' });
  assert.equal(noSource.ok, false);
  // no importance at all: classifier baseline WITH its named reason
  const classified = await store.save('t1', 'c1', { kind: 'unknown', content: 'misc note', sourceType: 'manual' });
  assert.equal(classified.importance, 2);
  assert.match(classified.importanceReason, /unclassified/);
});

test('chat responds with full memory records; failures are named, never claimed saved', async () => {
  const app = await bootApp({ chat: configuredChat(new FixtureChatA()), image: null });
  try {
    const { tenantId, characterId } = await app.demo();
    // Note: "my ex" deliberately avoided - the existing real-person safety
    // gate blocks it (correctly, for likeness protection), and this mission
    // does not modify safety semantics.
    const res = await app.call('POST', '/api/chat', { tenant: tenantId, body: { characterId, message: 'Remember that I work nights. Never bring up politics.' } });
    assert.equal(res.status, 200);
    assert.ok(res.body.newMemories.length >= 2);
    for (const m of res.body.newMemories) {
      assert.ok(Number.isInteger(m.importance), 'record carries importance');
      assert.ok(m.importanceReason, 'record carries its reason');
    }
    const boundary = res.body.newMemories.find((m) => m.kind === 'boundary');
    assert.equal(boundary.importance, 5);

    // Durable record present in the store with scope intact
    const list = await app.call('GET', `/api/memories?characterId=${characterId}`, { tenant: tenantId });
    assert.ok(list.body.some((m) => m.kind === 'boundary' && m.importanceReason));
    // Tenant isolation unchanged
    const cross = await app.call('GET', `/api/memories?characterId=${characterId}`, { tenant: 'intruder' });
    assert.deepEqual(cross.body, []);

    // Manual save without importance: named baseline, sourceType manual
    const manual = await app.call('POST', '/api/memories', { tenant: tenantId, body: { characterId, content: 'random note' } });
    assert.equal(manual.status, 201);
    assert.equal(manual.body.sourceType, 'manual');
    assert.match(manual.body.importanceReason, /unclassified/);
  } finally { await app.close(); }
});

test('UI: transcript gains no permanent memory bubble; confirmations are transient toasts', async () => {
  // No browser test framework exists (per mission, state/API behavior is
  // tested here and rendering is covered by the manual browser smoke).
  const src = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'app.js'), 'utf8');
  // Memory confirmations go through showToast with a TTL + fade + dismiss...
  assert.ok(src.includes('showToast(`Memory saved'), 'save confirmation is a toast');
  assert.ok(src.includes('showToast(`Memory NOT saved'), 'failure is a named error toast');
  assert.ok(/TOAST_TTL_MS = \d+/.test(src), 'toasts expire');
  assert.ok(src.includes("addEventListener('click', dismiss)"), 'toasts are manually dismissable');
  // ...and never through the transcript: addMsg accepts only chat roles.
  const addMsgCalls = [...src.matchAll(/addMsg\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(addMsgCalls)].sort(), ['assistant', 'blocked', 'user'], 'no memory-save bubbles in the transcript');
});
