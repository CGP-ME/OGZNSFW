import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootApp } from './helpers.js';
import { configuredChat, configuredImage, unconfigured, FixtureChatA, FixtureChatB, FixtureImageA, FixtureImageB } from './fixtures/providers.js';
import { createChatProvider, createImageProvider } from '../packages/providers/registry.js';
import { OllamaChatProvider } from '../packages/providers/chat/index.js';
import { HuggingFaceImageProvider } from '../packages/providers/image/index.js';

test('chat provider swap: same app, different provider, different label', async () => {
  for (const P of [FixtureChatA, FixtureChatB]) {
    const app = await bootApp({ chat: configuredChat(new P()), image: configuredImage(new FixtureImageA()) });
    try {
      const { tenantId, characterId } = await app.demo();
      const res = await app.call('POST', '/api/chat', { tenant: tenantId, body: { characterId, message: 'hello there' } });
      assert.equal(res.status, 200);
      assert.equal(res.body.provider, new P().name);
    } finally {
      await app.close();
    }
  }
});

test('image provider swap: same app, different provider, different label', async () => {
  for (const P of [FixtureImageA, FixtureImageB]) {
    const app = await bootApp({ chat: configuredChat(new FixtureChatA()), image: configuredImage(new P()) });
    try {
      const { tenantId, characterId } = await app.demo();
      const res = await app.call('POST', '/api/assets', { tenant: tenantId, body: { characterId, prompt: 'city skyline at night' } });
      assert.equal(res.status, 201);
      assert.equal(res.body.provider, new P().name);
    } finally {
      await app.close();
    }
  }
});

test('registry selects real implementations from env and refuses honestly otherwise', () => {
  // Unconfigured: no provider, honest reason, no fallback
  const none = createChatProvider({});
  assert.equal(none.provider, null);
  assert.match(none.status.reason, /no chat provider selected/);

  const noneImg = createImageProvider({});
  assert.equal(noneImg.provider, null);

  // Missing env: still no provider
  const half = createChatProvider({ CHAT_PROVIDER: 'ollama' });
  assert.equal(half.provider, null);
  assert.match(half.status.reason, /missing env/);

  // Fully configured: real adapter instances (construction only, no network)
  const ollama = createChatProvider({ CHAT_PROVIDER: 'ollama', OLLAMA_URL: 'http://127.0.0.1:11434', OLLAMA_MODEL: 'test-model' });
  assert.ok(ollama.provider instanceof OllamaChatProvider);

  const hf = createImageProvider({ IMAGE_PROVIDER: 'huggingface', HF_TOKEN: 'x', HF_IMAGE_MODEL: 'some/model' });
  assert.ok(hf.provider instanceof HuggingFaceImageProvider);

  // Unknown provider name refuses with the available list
  const unknown = createChatProvider({ CHAT_PROVIDER: 'nope' });
  assert.equal(unknown.provider, null);
  assert.match(unknown.status.reason, /unknown chat provider/);
});

test('unconfigured providers return honest 503, never fabricated output', async () => {
  const app = await bootApp({ chat: unconfigured('chat'), image: unconfigured('image') });
  try {
    const { tenantId, characterId } = await app.demo();
    const chatRes = await app.call('POST', '/api/chat', { tenant: tenantId, body: { characterId, message: 'hello' } });
    assert.equal(chatRes.status, 503);
    assert.match(chatRes.body.error, /no chat provider configured/);
    const imgRes = await app.call('POST', '/api/assets', { tenant: tenantId, body: { characterId, prompt: 'anything' } });
    assert.equal(imgRes.status, 503);
  } finally {
    await app.close();
  }
});

test('no runtime file imports test fixtures and no runtime mock providers exist', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const runtimeDirs = ['apps', 'packages', 'db'];
  for (const dir of runtimeDirs) {
    for (const file of await listJs(path.join(root, dir))) {
      const src = await readFile(file, 'utf8');
      assert.ok(!src.includes('fixtures/providers'), `${file} imports test fixtures`);
      assert.ok(!/class\s+Mock\w*Provider/.test(src), `${file} defines a mock provider in runtime`);
    }
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
