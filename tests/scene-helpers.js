// Shared setup for scene-layer tests: real store, real services, throwaway
// temp data dir. No providers, no network.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonStore } from '../db/store.js';
import { CharacterService } from '../packages/character-core/index.js';
import { ReferencePackService } from '../packages/character-core/reference-pack.js';
import { SceneService } from '../packages/character-core/scene.js';
import { validCharacter } from './helpers.js';

export async function bootSceneWorld() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'ogznsfw-scene-test-'));
  const store = new JsonStore(dataDir);
  const characters = new CharacterService(store);
  const refs = new ReferencePackService(store);
  const scenes = new SceneService(store, characters, refs);
  return { store, characters, refs, scenes };
}

// Creates a character (age 25 via validCharacter) + reference pack for the
// tenant and returns everything a scene entry needs.
export async function seedCharacter(world, tenantId, name, refSuffix = 'face-v1') {
  const created = await world.characters.create(tenantId, validCharacter(name));
  if (!created.ok) throw new Error('test character rejected: ' + created.errors.join('; '));
  const characterId = created.character.id;
  const ref = `asset://${name.toLowerCase()}-${refSuffix}`;
  await world.refs.register(tenantId, characterId, 1, [{ ref, kind: 'face' }]);
  return { characterId, ref };
}

export function sceneEntry({ characterId, ref }, overrides = {}) {
  return {
    characterId,
    characterVersion: 1,
    sceneRole: 'left foreground',
    referenceAssets: [ref],
    appearanceLock: { hair: 'red', eyes: 'green', identifyingMarks: [] },
    wardrobe: 'black jacket',
    poseAction: 'leaning against the bar',
    consent: { fictionalAdult: true, age: 25 },
    ...overrides,
  };
}

export function baseSceneInput(entries, overrides = {}) {
  return {
    characters: entries,
    setting: { location: 'rooftop bar at night', mood: 'relaxed' },
    relationships: [],
    composition: { spatial: 'two-shot, subjects one meter apart', camera: 'medium shot, eye level', lighting: 'neon rim light' },
    ...overrides,
  };
}
