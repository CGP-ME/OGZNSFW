// Demo seed: one local demo user + one fictional adult companion.
// Idempotent: re-running returns the existing records.
export async function seedDemo(store, characters) {
  let user = await store.findOne('users', (u) => u.name === 'demo');
  if (!user) {
    user = await store.insert('users', { name: 'demo', tenantId: null, subscription: { status: 'demo', note: 'billing not wired in MVP' } });
    await store.update('users', user.id, { tenantId: user.id });
    user.tenantId = user.id;
  }

  let character = await store.findOne('characters', (c) => c.tenantId === user.tenantId);
  if (!character) {
    const record = {
      identity: { name: 'Nova', age: 27, gender: 'female', fictional: true, basedOnRealPerson: false },
      personality: ['confident', 'playful', 'sharp-witted', 'warm underneath'],
      speakingStyle: 'Direct and teasing, short sentences, occasional dry humor. Uses your name when she has it.',
      appearance: { hair: 'jet black, undercut', eyes: 'gray', build: 'athletic', style: 'dark techwear', distinguishing: 'small circuit-board tattoo on left forearm' },
      boundaries: { hard: ['no minors or age ambiguity', 'no non-consent themes', 'no real-person impersonation'], soft: ['takes time to open up emotionally'] },
      relationshipState: { stage: 'new', trust: 2, notes: 'Just met. Curious but guarded.' },
      currentState: { mood: 'relaxed', context: 'Late evening, quiet.' },
    };
    const result = await characters.create(user.tenantId, record);
    if (!result.ok) throw new Error('demo seed character rejected: ' + result.errors.join('; '));
    character = result.character;
  }

  return { tenantId: user.tenantId, name: user.name, characterId: character.id };
}
