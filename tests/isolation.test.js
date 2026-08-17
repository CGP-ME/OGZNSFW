import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, validCharacter } from './helpers.js';
import { configuredChat, configuredImage, FixtureChatA, FixtureImageA } from './fixtures/providers.js';

test('tenant isolation: characters, memories, and assets never cross tenants', async () => {
  const app = await bootApp({ chat: configuredChat(new FixtureChatA()), image: configuredImage(new FixtureImageA()) });
  try {
    const { tenantId: tenantA } = await app.demo();
    const tenantB = 'tenant-b-other-user';

    // Tenant A creates a character, a memory, and an asset
    const created = await app.call('POST', '/api/characters', { tenant: tenantA, body: validCharacter('Ava') });
    const charId = created.body.id;
    await app.call('POST', '/api/memories', { tenant: tenantA, body: { characterId: charId, content: 'secret A fact', importance: 5 } });
    const asset = await app.call('POST', '/api/assets', { tenant: tenantA, body: { characterId: charId, prompt: 'portrait in neon light' } });
    assert.equal(asset.status, 201);

    // Tenant B cannot see any of it
    const bChar = await app.call('GET', `/api/characters/${charId}`, { tenant: tenantB });
    assert.equal(bChar.status, 404);
    const bMem = await app.call('GET', `/api/memories?characterId=${charId}`, { tenant: tenantB });
    assert.deepEqual(bMem.body, []);
    const bAssets = await app.call('GET', `/api/assets?characterId=${charId}`, { tenant: tenantB });
    assert.deepEqual(bAssets.body, []);
    const bChat = await app.call('POST', '/api/chat', { tenant: tenantB, body: { characterId: charId, message: 'hello' } });
    assert.equal(bChat.status, 404);

    // No tenant header at all: 401
    const noTenant = await app.call('GET', `/api/memories?characterId=${charId}`);
    assert.equal(noTenant.status, 401);
  } finally {
    await app.close();
  }
});
