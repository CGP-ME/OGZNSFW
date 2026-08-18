// Scene layer: the structured record that makes multi-character generation
// reliable. A scene binds exact character versions, per-character identity
// locks, reference assets, and scene-level composition into one validated
// unit with generation provenance. This is the architecture that prevents
// every scene from collapsing into the main character.
import { checkText } from '../safety/index.js';
import { evaluateValidationReport } from '../providers/image/image-validator.js';

// Structural + safety validation of a scene input (pure, no store access).
export function validateSceneShape(input) {
  const errors = [];
  const chars = input?.characters;
  if (!Array.isArray(chars) || chars.length === 0) {
    errors.push('scene requires at least one character');
    return { valid: false, errors };
  }

  const ids = chars.map((c) => c?.characterId).filter(Boolean);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) errors.push(`duplicate character IDs in scene: ${[...new Set(dupes)].join(', ')}`);

  chars.forEach((c, i) => {
    const label = c?.characterId ?? `characters[${i}]`;
    if (!c?.characterId) errors.push(`characters[${i}] missing characterId`);
    if (!Number.isInteger(c?.characterVersion)) errors.push(`${label}: exact integer characterVersion is required`);
    if (!c?.sceneRole || typeof c.sceneRole !== 'string') errors.push(`${label}: sceneRole (position/region) is required`);
    if (!c?.appearanceLock || typeof c.appearanceLock !== 'object' || Object.keys(c.appearanceLock).length === 0) {
      errors.push(`${label}: appearanceLock with at least one locked attribute is required`);
    }
    // Fictional-adult safety metadata is mandatory per character, fail closed.
    const consent = c?.consent;
    if (!consent || consent.fictionalAdult !== true) errors.push(`${label}: consent.fictionalAdult must be true`);
    if (!Number.isInteger(consent?.age)) errors.push(`${label}: consent.age must be an explicit integer (no ambiguous age)`);
    else if (consent.age < 18) errors.push(`${label}: consent.age must be 18 or older`);
    // Identity lock defaults ON; locked characters must carry reference assets.
    const identityLock = c?.identityLock !== false;
    if (identityLock && (!Array.isArray(c?.referenceAssets) || c.referenceAssets.length === 0)) {
      errors.push(`${label}: identity-locked characters require at least one reference asset`);
    }
  });

  // Relationships may only reference characters present in the scene.
  for (const rel of input.relationships ?? []) {
    for (const id of rel?.between ?? []) {
      if (!ids.includes(id)) errors.push(`relationship references character "${id}" not present in scene`);
    }
  }

  // Declared generation expectations must match the character list exactly.
  const declared = input.generation?.expectedCharacterIds;
  if (declared) {
    const a = [...declared].sort().join(',');
    const b = [...new Set(ids)].sort().join(',');
    if (a !== b) errors.push('generation.expectedCharacterIds does not match scene characters');
  }

  // Safety gate over every free-text field in the scene.
  const textFields = [];
  const pushText = (v) => { if (typeof v === 'string' && v.trim()) textFields.push(v); };
  Object.values(input.setting ?? {}).forEach(pushText);
  Object.values(input.composition ?? {}).forEach(pushText);
  (input.relationships ?? []).forEach((r) => { pushText(r?.type); pushText(r?.description); });
  chars.forEach((c) => { pushText(c?.wardrobe); pushText(c?.poseAction); pushText(c?.sceneRole); });
  for (const text of textFields) {
    const gate = checkText(text);
    if (!gate.allowed) errors.push(`scene text blocked (${gate.category}): "${gate.match}"`);
  }

  return { valid: errors.length === 0, errors };
}

export class SceneService {
  constructor(store, characterService, referencePacks) {
    this.store = store;
    this.characters = characterService;
    this.refs = referencePacks;
  }

  async create(tenantId, input) {
    if (!tenantId) return { ok: false, errors: ['tenantId required'] };

    const shape = validateSceneShape(input);
    const errors = [...shape.errors];
    if (!shape.valid) return { ok: false, errors };

    // Store-backed checks: exact versions exist for THIS tenant, consent
    // matches the canonical record, references resolve inside tenant scope.
    for (const c of input.characters) {
      const loaded = await this.characters.loadRecord(tenantId, c.characterId, c.characterVersion);
      if (!loaded) {
        errors.push(`${c.characterId}: version ${c.characterVersion} not found for this tenant`);
        continue;
      }
      if (loaded.record.identity.age !== c.consent.age) {
        errors.push(`${c.characterId}: consent.age (${c.consent.age}) does not match canonical record age (${loaded.record.identity.age})`);
      }
      if (c.identityLock !== false) {
        for (const ref of c.referenceAssets) {
          const resolved = await this.refs.resolve(tenantId, c.characterId, c.characterVersion, ref);
          if (!resolved) errors.push(`${c.characterId}: reference asset "${ref}" does not resolve for tenant+character+version (missing or belongs to another scope)`);
        }
      }
    }
    if (errors.length) return { ok: false, errors };

    const expectedCharacterIds = input.characters.map((c) => c.characterId);
    const scene = await this.store.insert('scenes', {
      tenantId,
      characters: input.characters,
      setting: input.setting ?? {},
      relationships: input.relationships ?? [],
      composition: input.composition ?? {},
      generation: {
        provider: input.generation?.provider ?? 'unconfigured',
        expectedCharacterIds,
        expectedCharacterVersions: Object.fromEntries(input.characters.map((c) => [c.characterId, c.characterVersion])),
        status: 'planned',
        validation: null,
      },
      validationStatus: 'pending',
    });
    return { ok: true, scene };
  }

  async get(tenantId, sceneId) {
    if (!tenantId) throw new Error('tenantId required');
    return this.store.findOne('scenes', (s) => s.id === sceneId && s.tenantId === tenantId);
  }

  async list(tenantId) {
    if (!tenantId) throw new Error('tenantId required');
    return this.store.find('scenes', (s) => s.tenantId === tenantId);
  }

  // Record a provider output on the scene (generated, not yet validated).
  async recordGeneration(tenantId, sceneId, output) {
    const scene = await this.get(tenantId, sceneId);
    if (!scene) return { ok: false, errors: ['scene not found for this tenant'] };
    await this.store.update('scenes', scene.id, {
      validationStatus: 'pending',
      generation: { ...scene.generation, status: 'generated', lastOutput: output, validation: null },
    });
    return { ok: true };
  }

  // Apply a validation report produced by an ImageValidator. Failed reports
  // mark the scene failed; nothing downstream may publish from a failed scene.
  async applyValidationReport(tenantId, sceneId, report) {
    const scene = await this.get(tenantId, sceneId);
    if (!scene) return { ok: false, errors: ['scene not found for this tenant'] };
    const verdict = evaluateValidationReport(report);
    const validationStatus = verdict.pass ? 'passed' : 'failed';
    await this.store.update('scenes', scene.id, {
      validationStatus,
      generation: { ...scene.generation, status: verdict.pass ? 'completed' : 'failed', validation: { report, verdict } },
    });
    return { ok: true, validationStatus, verdict };
  }

  // Gallery publication gate: only validation-passed scenes may store assets.
  // Failed or pending outputs are refused - never charged, never published.
  async publishAsset(tenantId, sceneId, { uri, provider, model }) {
    const scene = await this.get(tenantId, sceneId);
    if (!scene) return { ok: false, errors: ['scene not found for this tenant'] };
    if (scene.validationStatus !== 'passed') {
      return { ok: false, errors: [`refusing to publish: scene validation status is "${scene.validationStatus}" (must be "passed")`] };
    }
    const asset = await this.store.insert('assets', {
      tenantId,
      sceneId,
      characterId: scene.characters[0].characterId,
      characterIds: scene.generation.expectedCharacterIds,
      uri, provider, model,
      provenance: { expectedCharacterIds: scene.generation.expectedCharacterIds, validation: 'passed' },
    });
    return { ok: true, asset };
  }
}
