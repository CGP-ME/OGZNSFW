// Reference packs: the visual identity anchors for a character at an exact
// version (face refs, body refs, style refs). Every lookup is scoped by
// tenantId + characterId + characterVersion - a reference can never be
// resolved across tenants, and version drift is impossible because the
// version is part of the key.

export class ReferencePackService {
  constructor(store) {
    this.store = store;
  }

  // DOCTRINE rule 2: no throws. Returns whether the scope is intact; callers
  // refuse loudly rather than proceeding across scope. The producer (scene
  // validation) already guarantees these fields - this is a tripwire.
  scope(tenantId, characterId, characterVersion) {
    const missing = [];
    if (!tenantId) missing.push('tenantId');
    if (!characterId) missing.push('characterId');
    if (!Number.isInteger(characterVersion)) missing.push('integer characterVersion');
    if (missing.length) {
      console.error(`[${new Date().toISOString()}] TRIPWIRE ReferencePackService scope incomplete (${missing.join(', ')}) - refusing; reference access never proceeds on partial scope`);
      return false;
    }
    return true;
  }

  // assets: [{ ref: 'asset://nova-face-v3', kind: 'face'|'body'|'style', notes }]
  async register(tenantId, characterId, characterVersion, assets) {
    if (!this.scope(tenantId, characterId, characterVersion)) {
      return { ok: false, errors: ['reference-pack scope incomplete - refused, nothing written'] };
    }
    const bad = [];
    if (!Array.isArray(assets) || assets.length === 0) bad.push('at least one reference asset required');
    else for (const a of assets) { if (!a.ref || typeof a.ref !== 'string') bad.push('every reference asset needs a string ref'); }
    if (bad.length) {
      console.error(`[${new Date().toISOString()}] REFUSED ReferencePackService.register for ${characterId} v${characterVersion}: ${bad.join('; ')}`);
      return { ok: false, errors: bad };
    }
    const existing = await this.get(tenantId, characterId, characterVersion);
    if (existing) {
      return this.store.update('reference_packs', existing.id, { assets });
    }
    return this.store.insert('reference_packs', { tenantId, characterId, characterVersion, assets });
  }

  async get(tenantId, characterId, characterVersion) {
    if (!this.scope(tenantId, characterId, characterVersion)) return null;
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
