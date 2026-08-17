// Character core: canonical record shape, validation, versioning, and the
// prompt compiler that turns a character version + memories into a system
// prompt for whatever ChatProvider is active.
import { checkCharacter } from '../safety/index.js';

// Canonical record shape. Every field the product treats as character truth
// lives here and is versioned as one unit.
export function characterRecordTemplate() {
  return {
    identity: { name: '', age: null, gender: '', fictional: true, basedOnRealPerson: false },
    personality: [],
    speakingStyle: '',
    appearance: { hair: '', eyes: '', build: '', style: '', distinguishing: '' },
    boundaries: { hard: [], soft: [] },
    relationshipState: { stage: 'new', trust: 1, notes: '' },
    currentState: { mood: 'neutral', context: '' },
  };
}

const REQUIRED_SECTIONS = ['identity', 'personality', 'speakingStyle', 'appearance', 'boundaries', 'relationshipState', 'currentState'];

export function validateRecord(record) {
  const errors = [];
  for (const key of REQUIRED_SECTIONS) {
    if (record?.[key] === undefined || record?.[key] === null) errors.push(`missing section: ${key}`);
  }
  const safety = checkCharacter(record);
  if (!safety.allowed) errors.push(...safety.errors);
  return { valid: errors.length === 0, errors };
}

export class CharacterService {
  constructor(store) {
    this.store = store;
  }

  // Characters are stored as { id, tenantId, activeVersion, versions: [{version, record, createdAt}] }
  async create(tenantId, record) {
    if (!tenantId) throw new Error('tenantId required');
    const { valid, errors } = validateRecord(record);
    if (!valid) return { ok: false, errors };
    const doc = await this.store.insert('characters', {
      tenantId,
      activeVersion: 1,
      versions: [{ version: 1, record, createdAt: new Date().toISOString() }],
    });
    return { ok: true, character: doc };
  }

  async addVersion(tenantId, characterId, record) {
    const doc = await this.get(tenantId, characterId);
    if (!doc) return { ok: false, errors: ['character not found for tenant'] };
    const { valid, errors } = validateRecord(record);
    if (!valid) return { ok: false, errors };
    const version = doc.versions.length + 1;
    doc.versions.push({ version, record, createdAt: new Date().toISOString() });
    await this.store.update('characters', doc.id, { versions: doc.versions, activeVersion: version });
    return { ok: true, version };
  }

  // Tenant scoping is enforced here: lookups without the owning tenantId miss.
  async get(tenantId, characterId) {
    if (!tenantId) throw new Error('tenantId required');
    return this.store.findOne('characters', (c) => c.id === characterId && c.tenantId === tenantId);
  }

  async list(tenantId) {
    if (!tenantId) throw new Error('tenantId required');
    return this.store.find('characters', (c) => c.tenantId === tenantId);
  }

  // Load a specific version's record (defaults to active).
  async loadRecord(tenantId, characterId, version = null) {
    const doc = await this.get(tenantId, characterId);
    if (!doc) return null;
    const wanted = version ?? doc.activeVersion;
    const entry = doc.versions.find((v) => v.version === wanted);
    return entry ? { version: entry.version, record: entry.record } : null;
  }
}

// Compile the system prompt from a character record + retrieved memories.
export function compilePrompt(record, memories = []) {
  const lines = [];
  lines.push('You are roleplaying a fictional adult character on a private companion platform.');
  lines.push('All participants and characters are consenting fictional adults.');
  lines.push('Refuse and redirect any request involving minors, ambiguous ages, non-consent, or real-person likeness.');
  lines.push('');
  lines.push(`Name: ${record.identity.name} (age ${record.identity.age}, ${record.identity.gender}, fictional)`);
  lines.push(`Personality: ${record.personality.join(', ')}`);
  lines.push(`Speaking style: ${record.speakingStyle}`);
  const a = record.appearance;
  lines.push(`Appearance: hair ${a.hair}; eyes ${a.eyes}; build ${a.build}; style ${a.style}; distinguishing ${a.distinguishing}`);
  if (record.boundaries.hard.length) lines.push(`Hard boundaries (never violate): ${record.boundaries.hard.join('; ')}`);
  if (record.boundaries.soft.length) lines.push(`Soft boundaries (approach carefully): ${record.boundaries.soft.join('; ')}`);
  lines.push(`Relationship stage: ${record.relationshipState.stage} (trust ${record.relationshipState.trust}/10). ${record.relationshipState.notes}`);
  lines.push(`Current state: ${record.currentState.mood}. ${record.currentState.context}`);
  if (memories.length) {
    lines.push('');
    lines.push('Things you remember about this user:');
    for (const m of memories) lines.push(`- (${m.kind}, importance ${m.importance}) ${m.content}`);
  }
  return lines.join('\n');
}
