import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, validCharacter } from './helpers.js';
import { configuredChat, configuredImage, FixtureChatA, FixtureImageA } from './fixtures/providers.js';

test('character version loading returns the requested version', async () => {
  const app = await bootApp({ chat: configuredChat(new FixtureChatA()), image: configuredImage(new FixtureImageA()) });
  try {
    const { tenantId } = await app.demo();
    const created = await app.call('POST', '/api/characters', { tenant: tenantId, body: validCharacter('Vera') });
    assert.equal(created.status, 201);
    const id = created.body.id;

    const v1 = await app.call('GET', `/api/characters/${id}`, { tenant: tenantId });
    assert.equal(v1.status, 200);
    assert.equal(v1.body.version, 1);
    assert.equal(v1.body.record.identity.name, 'Vera');

    // add a v2 through the service by direct store access path: create is
    // API-only in MVP, so verify explicit-version loading with version=1
    const v1again = await app.call('GET', `/api/characters/${id}?version=1`, { tenant: tenantId });
    assert.equal(v1again.body.version, 1);

    const missing = await app.call('GET', `/api/characters/${id}?version=99`, { tenant: tenantId });
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

test('character records missing required sections or safety fields are rejected', async () => {
  const app = await bootApp({ chat: configuredChat(new FixtureChatA()), image: configuredImage(new FixtureImageA()) });
  try {
    const { tenantId } = await app.demo();

    const noAge = validCharacter('NoAge');
    noAge.identity.age = null;
    const r1 = await app.call('POST', '/api/characters', { tenant: tenantId, body: noAge });
    assert.equal(r1.status, 422);
    assert.ok(r1.body.details.some((e) => e.includes('age')));

    const notFictional = validCharacter('Real');
    notFictional.identity.fictional = false;
    const r2 = await app.call('POST', '/api/characters', { tenant: tenantId, body: notFictional });
    assert.equal(r2.status, 422);
  } finally {
    await app.close();
  }
});
