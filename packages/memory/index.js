// Structured memory: storage, retrieval, and the extraction interface.
// Every operation is scoped by tenantId + characterId.

// ---------------------------------------------------------------------------
// RETENTION-PRIORITY RUBRIC (defined once, here)
//
// importance = retention priority. It is NOT emotional understanding, and
// the UI says so wherever the score is shown. importance and confidence are
// deliberately separate: importance is how strongly a memory should be
// retained; confidence is how certain the extractor is that the pattern
// matched what the user meant.
// ---------------------------------------------------------------------------
export const RETENTION_RUBRIC = Object.freeze({
  1: 'casual or low-retention detail',
  2: 'useful short-term context or preference',
  3: 'recurring preference or meaningful fact',
  4: 'durable personal preference, relationship fact, or important event',
  5: 'explicit boundary, safety-related information, or identity-critical fact',
});

// Deterministic classification for a memory candidate. Returns the full
// truthful record: importance + the reason it got that importance + pattern
// confidence. No classification path invents a score without naming why.
export function classifyRetention(kind, { explicitRequest = false } = {}) {
  switch (kind) {
    case 'boundary':
      return { importance: 5, importanceReason: 'major boundary or safety-related statement', confidence: 0.8 };
    case 'identity':
      return { importance: 4, importanceReason: explicitRequest ? 'identity fact from an explicit request' : 'identity fact stated by the user', confidence: 0.9 };
    case 'explicit-fact':
      return { importance: 4, importanceReason: 'explicit remember request', confidence: 0.9 };
    case 'preference':
      return { importance: 3, importanceReason: 'recurring preference or meaningful fact', confidence: 0.6 };
    case 'casual':
      return { importance: 2, importanceReason: 'casual or short-term detail', confidence: 0.6 };
    default:
      // Unclassified content gets the named baseline - never a silent
      // default and never a fake understanding claim.
      return { importance: 2, importanceReason: 'unclassified entry - baseline retention priority', confidence: null };
  }
}

export class MemoryStore {
  constructor(store) {
    this.store = store;
  }

  // DOCTRINE rule 2: no throws. Memory scope is a tenant security boundary -
  // it never proceeds partial, and it never kills the request.
  scope(tenantId, characterId) {
    if (!tenantId || !characterId) {
      console.error(`[${new Date().toISOString()}] TRIPWIRE MemoryStore scope incomplete (tenantId=${!!tenantId}, characterId=${!!characterId}) - refusing; memory never crosses scope`);
      return false;
    }
    return true;
  }

  async save(tenantId, characterId, { kind = 'fact', content, importance, importanceReason, confidence = null, sourceType }) {
    if (!this.scope(tenantId, characterId)) return { ok: false, errors: ['memory scope incomplete - refused, nothing written'] };
    if (!content || typeof content !== 'string') {
      console.error(`[${new Date().toISOString()}] REFUSED MemoryStore.save for ${characterId}: no content supplied`);
      return { ok: false, errors: ['memory content required - refused, nothing written'] };
    }
    if (!sourceType || typeof sourceType !== 'string') {
      console.error(`[${new Date().toISOString()}] REFUSED MemoryStore.save for ${characterId}: no sourceType - every memory names where it came from`);
      return { ok: false, errors: ['sourceType required - refused, nothing written'] };
    }
    // DOCTRINE: no silent defaults that decide. A score arrives WITH its
    // reason, or the caller gets the classifier's named baseline - never a
    // bare invented number.
    if (importance !== undefined && (!Number.isInteger(importance) || importance < 1 || importance > 5 || !importanceReason)) {
      console.error(`[${new Date().toISOString()}] REFUSED MemoryStore.save for ${characterId}: importance must be an integer 1-5 WITH an importanceReason`);
      return { ok: false, errors: ['importance must be an integer 1-5 accompanied by importanceReason - refused, nothing written'] };
    }
    if (importance === undefined) {
      const c = classifyRetention(kind);
      importance = c.importance;
      importanceReason = c.importanceReason;
      if (confidence === null) confidence = c.confidence;
    }
    return this.store.insert('memories', {
      tenantId, characterId, kind, content,
      importance, importanceReason, confidence, sourceType,
      retention: 'active', lastAccessed: null,
    });
  }

  // Retrieval: importance-weighted recency, optional keyword filter.
  // MVP ranking is deliberately simple; embedding/RAG retrieval is a later
  // milestone and slots in behind this same method signature.
  async retrieve(tenantId, characterId, { query = null, limit = 8 } = {}) {
    if (!this.scope(tenantId, characterId)) return [];
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
    if (!this.scope(tenantId, characterId)) return [];
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
    const push = (kind, content, opts = {}) => {
      const c = classifyRetention(kind, opts);
      found.push({ kind, content, importance: c.importance, importanceReason: c.importanceReason, confidence: c.confidence, sourceType: 'chat-extraction-heuristic' });
    };

    // Boundaries and safety-relevant statements: highest retention (rubric 5).
    let m = text.match(/\b(?:that(?:'s| is) (?:a )?(?:hard )?(?:boundary|limit)|never (?:ever )?(?:mention|bring up|call me|ask (?:me )?about|do that|touch)\s*(.{0,100}?))(?:[.!?]|$)/i);
    if (m) push('boundary', `Boundary: ${m[0].trim()}`);

    m = text.match(/\bremember\s+(?:that\s+)?(.{4,200}?)(?:[.!?]|$)/i);
    if (m && !/\bnever\b/i.test(m[1])) push('explicit-fact', m[1].trim(), { explicitRequest: true });

    m = text.match(/\bmy name is\s+([A-Za-z][\w'-]{1,40})/i);
    if (m) push('identity', `User's name is ${m[1]}`);

    m = text.match(/\bcall me\s+([A-Za-z][\w'-]{1,40})/i);
    if (m) push('identity', `User wants to be called ${m[1]}`);

    m = text.match(/\bmy favorite\s+([\w ]{2,40}?)\s+is\s+(.{2,80}?)(?:[.!?]|$)/i);
    if (m) push('preference', `User's favorite ${m[1].trim()} is ${m[2].trim()}`);

    m = text.match(/\bi (?:really\s+)?(love|like|enjoy|prefer|hate|dislike)\s+(.{3,120}?)(?:[.!?]|$)/i);
    if (m) push('preference', `User ${m[1].toLowerCase()}s ${m[2].trim()}`.replace(/ss\b/, 's'));

    // Transient smalltalk: extracted at low retention rather than pretending
    // it is durable truth.
    m = text.match(/\bi(?:'m| am) (?:really )?(?:craving|in the mood for)\s+(.{3,80}?)(?:[.!?]|$)/i);
    if (m) push('casual', `User is currently craving ${m[1].trim()}`);

    return found;
  }
}
