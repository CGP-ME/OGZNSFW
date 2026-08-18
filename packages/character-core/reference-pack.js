// Reference packs: the visual identity anchors for a character at an exact
// version (face refs, body refs, style refs). Every lookup is scoped by
// tenantId + characterId + characterVersion - a reference can never be
// resolved across tenants, and version drift is impossible because the
// version is part of the key.

export class ReferencePackService {
  constructor(store) {
    this.store = store;
  }

  scope(tenantId, characterId, characterVersion) {
    if (!tenantId || !characterId || !Number.isInteger(characterVersion)) {
      throw new Error('tenantId, characterId, and integer characterVersion are all required for reference-pack access');
    }
  }

  // assets: [{ ref: 'asset://nova-face-v3', kind: 'face'|'body'|'style', notes }]
  async register(tenantId, characterId, characterVersion, assets) {
    this.scope(tenantId, characterId, characterVersion);
    if (!Array.isArray(assets) || assets.length === 0) throw new Error('at least one reference asset required');
    for (const a of assets) {
      if (!a.ref || typeof a.ref !== 'string') throw new Error('every reference asset needs a string ref');
    }
    const existing = await this.get(tenantId, characterId, characterVersion);
    if (existing) {
      return this.store.update('reference_packs', existing.id, { assets });
    }
    return this.store.insert('reference_packs', { tenantId, characterId, characterVersion, assets });
  }

  async get(tenantId, characterId, characterVersion) {
    this.scope(tenantId, characterId, characterVersion);
    return this.store.findOne('reference_packs', (p) =>
      p.tenantId === tenantId && p.characterId === characterId && p.characterVersion === characterVersion);
  }

  // Resolve one asset ref within the scoped pack. Returns the asset or null.
  // A ref belonging to another tenant/character/version resolves to null -
  // the caller treats null as a hard rejection, never as "probably fine".
  async resolve(tenantId, characterId, characterVersion, ref) {
    const pack = await this.get(tenantId, characterId, characterVersion);
    if (!pack) return null;
    return pack.assets.find((a) => a.ref === ref) ?? null;
  }
}
