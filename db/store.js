// Minimal JSON-file document store. Local MVP only; the API surface is kept
// small and boring so it can be swapped for SQLite/Postgres without touching
// callers. One JSON file per collection under db/data/.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class JsonStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.cache = new Map();
    this.writing = Promise.resolve();
  }

  filePath(collection) {
    if (!/^[a-z][a-z0-9_-]*$/i.test(collection)) throw new Error(`Bad collection name: ${collection}`);
    return path.join(this.dataDir, `${collection}.json`);
  }

  async load(collection) {
    if (this.cache.has(collection)) return this.cache.get(collection);
    let docs = [];
    try {
      docs = JSON.parse(await fs.readFile(this.filePath(collection), 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    this.cache.set(collection, docs);
    return docs;
  }

  async persist(collection) {
    const docs = this.cache.get(collection) ?? [];
    // serialize writes so concurrent requests cannot interleave a file write
    this.writing = this.writing.then(async () => {
      await fs.mkdir(this.dataDir, { recursive: true });
      const tmp = this.filePath(collection) + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(docs, null, 2), 'utf8');
      await fs.rename(tmp, this.filePath(collection));
    });
    return this.writing;
  }

  async insert(collection, doc) {
    const docs = await this.load(collection);
    const record = { id: randomUUID(), createdAt: new Date().toISOString(), ...doc };
    docs.push(record);
    await this.persist(collection);
    return record;
  }

  async find(collection, predicate = () => true) {
    const docs = await this.load(collection);
    return docs.filter(predicate);
  }

  async findOne(collection, predicate) {
    return (await this.find(collection, predicate))[0] ?? null;
  }

  async update(collection, id, patch) {
    const docs = await this.load(collection);
    const doc = docs.find((d) => d.id === id);
    if (!doc) return null;
    Object.assign(doc, patch, { updatedAt: new Date().toISOString() });
    await this.persist(collection);
    return doc;
  }
}
