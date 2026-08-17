import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers.js';
import { configuredChat, configuredImage, FixtureChatA, FixtureImageA } from './fixtures/providers.js';

test('memory save, retrieval, and use in the chat loop', async () => {
  const app = await bootApp({ chat: configuredChat(new FixtureChatA()), image: configuredImage(new FixtureImageA()) });
  try {
    const { tenantId, characterId } = await app.demo();

    // Save explicitly
    const saved = await app.call('POST', '/api/memories', { tenant: tenantId, body: { characterId, kind: 'fact', content: 'User works night shifts', importance: 4 } });
    assert.equal(saved.status, 201);

    // Extraction from a chat message ("my name is ...")
    const chat1 = await app.call('POST', '/api/chat', { tenant: tenantId, body: { characterId, message: 'Hey, my name is Trey.' } });
    assert.equal(chat1.status, 200);
    assert.ok(chat1.body.newMemories.some((m) => m.includes('Trey')));

    // Retrieval: a later message about work should surface the night-shift fact
    const chat2 = await app.call('POST', '/api/chat', { tenant: tenantId, body: { characterId, message: 'work has been rough lately' } });
    assert.equal(chat2.status, 200);
    assert.ok(chat2.body.usedMemories.some((m) => m.includes('night shifts')));

    // Listing shows both
    const list = await app.call('GET', `/api/memories?characterId=${characterId}`, { tenant: tenantId });
    assert.ok(list.body.length >= 2);
  } finally {
    await app.close();
  }
});
