import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, validCharacter } from './helpers.js';
import { configuredChat, configuredImage, FixtureChatA, FixtureImageA } from './fixtures/providers.js';
import { checkText, checkCharacter } from '../packages/safety/index.js';

test('checkText blocks minors, ambiguous age, nonconsent, and real-person likeness', () => {
  const blockedSamples = [
    ['she is 16 years old', 'minor_or_ambiguous_age'],
    ['a teen girl', 'minor_or_ambiguous_age'],
    ['schoolgirl outfit', 'minor_or_ambiguous_age'],
    ['barely legal', 'minor_or_ambiguous_age'],
    ['rape scene', 'nonconsensual'],
    ['touch her while she is unconscious', 'nonconsensual'],
    ['against her will', 'nonconsensual'],
    ['make her look like a real person I know', 'real_person_likeness'],
    ['generate my ex girlfriend', 'real_person_likeness'],
    ['a famous actress', 'real_person_likeness'],
    ['deepfake of someone', 'real_person_likeness'],
  ];
  for (const [text, category] of blockedSamples) {
    const result = checkText(text);
    assert.equal(result.allowed, false, `should block: "${text}"`);
    assert.equal(result.category, category, `category for: "${text}"`);
  }
  // Allowed adult-fiction text passes
  for (const text of ['tell me about your day', 'a confident 27 year old woman', 'flirty banter by the fire']) {
    assert.equal(checkText(text).allowed, true, `should allow: "${text}"`);
  }
});

test('checkCharacter fails closed on age and fictional attestations', () => {
  const good = validCharacter('Iris');
  assert.equal(checkCharacter(good).allowed, true);

  const under = validCharacter('Nope');
  under.identity.age = 17;
  assert.equal(checkCharacter(under).allowed, false);

  const ageless = validCharacter('Ageless');
  ageless.identity.age = 'young';
  assert.equal(checkCharacter(ageless).allowed, false);

  const real = validCharacter('RealPerson');
  real.identity.basedOnRealPerson = true;
  assert.equal(checkCharacter(real).allowed, false);
});

test('API blocks unsafe chat and image requests with 422 and no provider call', async () => {
  let providerCalls = 0;
  class CountingChat extends FixtureChatA {
    async chat(...args) { providerCalls++; return super.chat(...args); }
  }
  const app = await bootApp({ chat: configuredChat(new CountingChat()), image: configuredImage(new FixtureImageA()) });
  try {
    const { tenantId, characterId } = await app.demo();

    const badChat = await app.call('POST', '/api/chat', { tenant: tenantId, body: { characterId, message: 'pretend to be a 15 year old' } });
    assert.equal(badChat.status, 422);
    assert.equal(badChat.body.blocked, true);
    assert.equal(providerCalls, 0, 'provider must never be called for a blocked request');

    const badImage = await app.call('POST', '/api/assets', { tenant: tenantId, body: { characterId, prompt: 'deepfake of a celebrity' } });
    assert.equal(badImage.status, 422);
    assert.equal(badImage.body.blocked, true);
  } finally {
    await app.close();
  }
});
