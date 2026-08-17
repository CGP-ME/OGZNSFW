// Structured memory: storage, retrieval, and the extraction interface.
// Every operation is scoped by tenantId + characterId; the store methods
// throw rather than default when scope is missing.

export class MemoryStore {
  constructor(store) {
    this.store = store;
  }

  scope(tenantId, characterId) {
    if (!tenantId || !characterId) throw new Error('tenantId and characterId are both required for memory access');
  }

  async save(tenantId, characterId, { kind = 'fact', content, importance = 3 }) {
    this.scope(tenantId, characterId);
    if (!content || typeof content !== 'string') throw new Error('memory content required');
    importance = Math.min(5, Math.max(1, Number(importance) || 3));
    return this.store.insert('memories', { tenantId, characterId, kind, content, importance, lastAccessed: null });
  }

  // Retrieval: importance-weighted recency, optional keyword filter.
  // MVP ranking is deliberately simple; embedding/RAG retrieval is a later
  // milestone and slots in behind this same method signature.
  async retrieve(tenantId, characterId, { query = null, limit = 8 } = {}) {
    this.scope(tenantId, characterId);
    let docs = await this.store.find('memories', (m) => m.tenantId === tenantId && m.characterId === characterId);
    if (query) {
      const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
      const scored = docs.map((m) => ({
        m,
        hits: terms.filter((t) => m.content.toLowerCase().includes(t)).length,
      }));
      const matching = scored.filter((s) => s.hits > 0);
      if (matching.length > 0) docs = matching.sort((x, y) => y.hits - x.hits).map((s) => s.m);
    }
    docs = docs
      .slice()
      .sort((x, y) => y.importance - x.importance || (y.createdAt > x.createdAt ? 1 : -1))
      .slice(0, limit);
    const now = new Date().toISOString();
    for (const m of docs) await this.store.update('memories', m.id, { lastAccessed: now });
    return docs;
  }

  async list(tenantId, characterId) {
    this.scope(tenantId, characterId);
    return this.store.find('memories', (m) => m.tenantId === tenantId && m.characterId === characterId);
  }
}

// Extraction interface: implementations take the user's message and return
// zero or more memory candidates. A model-backed extractor is a later
// milestone; the heuristic extractor below is honest about what it is.
export class MemoryExtractor {
  // eslint-disable-next-line no-unused-vars
  async extract(userMessage) {
    throw new Error('extract() not implemented');
  }
}

export class HeuristicMemoryExtractor extends MemoryExtractor {
  async extract(userMessage) {
    const found = [];
    const text = userMessage.trim();
    let m = text.match(/\bremember\s+(?:that\s+)?(.{4,200}?)(?:[.!?]|$)/i);
    if (m) found.push({ kind: 'fact', content: m[1].trim(), importance: 4 });
    m = text.match(/\bmy name is\s+([A-Za-z][\w'-]{1,40})/i);
    if (m) found.push({ kind: 'fact', content: `User's name is ${m[1]}`, importance: 5 });
    m = text.match(/\bcall me\s+([A-Za-z][\w'-]{1,40})/i);
    if (m) found.push({ kind: 'preference', content: `User wants to be called ${m[1]}`, importance: 5 });
    m = text.match(/\bi (?:really\s+)?(love|like|enjoy|prefer|hate|dislike)\s+(.{3,120}?)(?:[.!?]|$)/i);
    if (m) found.push({ kind: 'preference', content: `User ${m[1].toLowerCase()}s ${m[2].trim()}`.replace(/ss\b/, 's'), importance: 3 });
    return found;
  }
}
