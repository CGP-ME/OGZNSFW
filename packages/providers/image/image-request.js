// Structured image request compiler. Turns a validated scene into a request
// object that PRESERVES structure: per-character identity instructions stay
// separate from each other and from scene-level instructions. There is
// deliberately no single flattened prompt string anywhere in this shape -
// collapsing a multi-character scene into one free-form prompt is exactly the
// failure mode this layer exists to prevent. Providers that need text render
// it per-section at the adapter boundary, keeping provenance intact.

function identityInstructionsFor(sceneCharacter, record) {
  const lock = sceneCharacter.appearanceLock ?? {};
  const rec = record?.appearance ?? {};
  const merged = { ...rec, ...lock };
  const marks = Array.isArray(lock.identifyingMarks) && lock.identifyingMarks.length
    ? lock.identifyingMarks
    : (rec.distinguishing ? [rec.distinguishing] : []);
  return {
    characterId: sceneCharacter.characterId,
    characterVersion: sceneCharacter.characterVersion,
    locked: merged,
    identifyingMarks: marks,
    distinctness: `${sceneCharacter.characterId} must remain a visually distinct individual; never merge features with any other character in this scene`,
  };
}

// scene: a stored scene record from SceneService
// records: { [characterId]: { version, record } } canonical records at the scene's exact versions
export function compileImageRequest(scene, records) {
  if (!scene?.characters?.length) throw new Error('cannot compile an image request from a scene with no characters');
  for (const c of scene.characters) {
    if (!records?.[c.characterId]) throw new Error(`missing canonical record for ${c.characterId}`);
    if (records[c.characterId].version !== c.characterVersion) {
      throw new Error(`record version mismatch for ${c.characterId}: scene expects v${c.characterVersion}, got v${records[c.characterId].version}`);
    }
  }

  return {
    kind: 'multi-character-image-request',
    sceneId: scene.id,
    tenantId: scene.tenantId,
    // Scene-level instructions: kept separate from character identity.
    scene: {
      setting: scene.setting,
      composition: scene.composition,
      relationships: scene.relationships,
    },
    // Per-character blocks: identity, wardrobe, pose, role, and references
    // travel together per character and never blend across characters.
    characters: scene.characters.map((c) => ({
      characterId: c.characterId,
      characterVersion: c.characterVersion,
      sceneRole: c.sceneRole,
      identity: identityInstructionsFor(c, records[c.characterId].record),
      wardrobe: c.wardrobe ?? null,
      poseAction: c.poseAction ?? null,
      referenceAssets: c.referenceAssets ?? [],
      identityLock: c.identityLock !== false,
    })),
    constraints: {
      fictionalAdultsOnly: true,
      allCharactersMustAppear: true,
      noFeatureMerging: true,
    },
    provenance: {
      expectedCharacterIds: scene.generation.expectedCharacterIds,
      expectedCharacterVersions: scene.generation.expectedCharacterVersions,
      provider: scene.generation.provider,
      status: 'planned',
      compiledAt: new Date().toISOString(),
    },
  };
}
