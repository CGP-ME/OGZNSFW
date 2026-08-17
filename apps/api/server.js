// OGZNSFW MVP API. One Express server: JSON API + static web UI.
// Vertical slice: demo auth -> companion -> chat (memory-aware) -> memories -> images -> gallery.
//
// No mock data anywhere. Unconfigured providers produce honest 503 states
// with setup instructions; nothing fabricates a reply or an image.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore } from '../../db/store.js';
import { CharacterService, compilePrompt, characterRecordTemplate } from '../../packages/character-core/index.js';
import { MemoryStore, HeuristicMemoryExtractor } from '../../packages/memory/index.js';
import { createChatProvider, createImageProvider, registryInfo } from '../../packages/providers/registry.js';
import { checkText } from '../../packages/safety/index.js';
import { seedDemo } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

export function createApp({ store, chat, image } = {}) {
  store = store ?? new JsonStore(path.join(ROOT, 'db', 'data'));
  chat = chat ?? createChatProvider();
  image = image ?? createImageProvider();
  const characters = new CharacterService(store);
  const memories = new MemoryStore(store);
  const extractor = new HeuristicMemoryExtractor();

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(ROOT, 'apps', 'web')));

  // --- demo auth: single local demo tenant; real accounts are a later
  // milestone. Every API route requires the tenant header; nothing defaults
  // to a shared scope.
  app.post('/api/auth/demo', async (req, res) => {
    const user = await seedDemo(store, characters);
    res.json({ tenantId: user.tenantId, name: user.name, characterId: user.characterId });
  });

  function requireTenant(req, res) {
    const t = req.get('X-Tenant-Id') || null;
    if (!t) res.status(401).json({ error: 'X-Tenant-Id header required' });
    return t;
  }

  // --- provider status: honest. "configured" comes from the registry
  // selection; "reachable" only after a live probe round-trip.
  app.get('/api/providers', async (req, res) => {
    const probe = req.query.probe === '1';
    const out = {
      registry: registryInfo(),
      chat: { ...chat.status, provider: chat.provider ? chat.provider.name : null },
      image: { ...image.status, provider: image.provider ? image.provider.name : null },
    };
    if (probe) {
      out.chat.probe = chat.provider ? await chat.provider.probe() : { reachable: false, detail: chat.status.reason };
      out.image.probe = image.provider ? await image.provider.probe() : { reachable: false, detail: image.status.reason };
    }
    res.json(out);
  });

  // --- characters
  app.get('/api/characters', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const list = await characters.list(tenantId);
    res.json(list.map((c) => ({ id: c.id, activeVersion: c.activeVersion, versions: c.versions.length, record: c.versions.find((v) => v.version === c.activeVersion)?.record })));
  });

  app.get('/api/characters/:id', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const version = req.query.version ? Number(req.query.version) : null;
    const loaded = await characters.loadRecord(tenantId, req.params.id, version);
    if (!loaded) return res.status(404).json({ error: 'character not found for this tenant' });
    res.json(loaded);
  });

  app.post('/api/characters', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const record = { ...characterRecordTemplate(), ...req.body };
    const result = await characters.create(tenantId, record);
    if (!result.ok) return res.status(422).json({ error: 'character rejected', details: result.errors });
    res.status(201).json({ id: result.character.id, activeVersion: 1 });
  });

  // --- chat: safety gate -> memory retrieval -> prompt compile -> provider ->
  // history save -> memory extraction. This is the core loop.
  app.post('/api/chat', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    if (!chat.provider) {
      return res.status(503).json({ error: 'no chat provider configured', how: chat.status.reason });
    }
    const { characterId, message } = req.body ?? {};
    if (!characterId || !message) return res.status(400).json({ error: 'characterId and message required' });

    const gate = checkText(message);
    if (!gate.allowed) {
      console.log(`[${new Date().toISOString()}] BLOCKED chat tenant=${tenantId} category=${gate.category} match="${gate.match}"`);
      return res.status(422).json({ blocked: true, category: gate.category, error: 'This request violates platform rules (fictional consenting adults only).' });
    }

    const loaded = await characters.loadRecord(tenantId, characterId);
    if (!loaded) return res.status(404).json({ error: 'character not found for this tenant' });

    const relevant = await memories.retrieve(tenantId, characterId, { query: message, limit: 8 });
    const systemPrompt = compilePrompt(loaded.record, relevant);
    const history = await store.find('conversation_turns', (t) => t.tenantId === tenantId && t.characterId === characterId);
    const recentHistory = history.slice(-10).map((t) => ({ role: t.role, content: t.content }));

    let result;
    try {
      result = await chat.provider.chat(systemPrompt, recentHistory, message);
    } catch (err) {
      console.log(`[${new Date().toISOString()}] chat provider "${chat.provider.name}" failed: ${err.message}`);
      return res.status(502).json({ error: `chat provider "${chat.provider.name}" failed`, detail: err.message });
    }

    await store.insert('conversation_turns', { tenantId, characterId, role: 'user', content: message });
    await store.insert('conversation_turns', { tenantId, characterId, role: 'assistant', content: result.reply });

    const extracted = await extractor.extract(message);
    const saved = [];
    for (const cand of extracted) saved.push(await memories.save(tenantId, characterId, cand));

    res.json({ reply: result.reply, provider: result.provider, model: result.model, usedMemories: relevant.map((m) => m.content), newMemories: saved.map((m) => m.content) });
  });

  app.get('/api/chat/history', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const { characterId } = req.query;
    if (!characterId) return res.status(400).json({ error: 'characterId required' });
    const turns = await store.find('conversation_turns', (t) => t.tenantId === tenantId && t.characterId === characterId);
    res.json(turns.map((t) => ({ role: t.role, content: t.content, at: t.createdAt })));
  });

  // --- memories
  app.get('/api/memories', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const { characterId } = req.query;
    if (!characterId) return res.status(400).json({ error: 'characterId required' });
    res.json(await memories.list(tenantId, characterId));
  });

  app.post('/api/memories', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const { characterId, kind, content, importance } = req.body ?? {};
    if (!characterId || !content) return res.status(400).json({ error: 'characterId and content required' });
    res.status(201).json(await memories.save(tenantId, characterId, { kind, content, importance }));
  });

  // --- images: safety gate -> provider -> private asset record
  app.post('/api/assets', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    if (!image.provider) {
      return res.status(503).json({ error: 'no image provider configured', how: image.status.reason });
    }
    const { characterId, prompt } = req.body ?? {};
    if (!characterId || !prompt) return res.status(400).json({ error: 'characterId and prompt required' });

    const gate = checkText(prompt);
    if (!gate.allowed) {
      console.log(`[${new Date().toISOString()}] BLOCKED image tenant=${tenantId} category=${gate.category} match="${gate.match}"`);
      return res.status(422).json({ blocked: true, category: gate.category, error: 'This request violates platform rules (fictional consenting adults only).' });
    }

    const loaded = await characters.loadRecord(tenantId, characterId);
    if (!loaded) return res.status(404).json({ error: 'character not found for this tenant' });

    let result;
    try {
      result = await image.provider.generate({ prompt, characterRecord: loaded.record });
    } catch (err) {
      console.log(`[${new Date().toISOString()}] image provider "${image.provider.name}" failed: ${err.message}`);
      return res.status(502).json({ error: `image provider "${image.provider.name}" failed`, detail: err.message });
    }

    const asset = await store.insert('assets', { tenantId, characterId, prompt, uri: result.uri, provider: result.provider, model: result.model });
    res.status(201).json({ id: asset.id, uri: asset.uri, provider: asset.provider, model: asset.model, createdAt: asset.createdAt });
  });

  app.get('/api/assets', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const { characterId } = req.query;
    if (!characterId) return res.status(400).json({ error: 'characterId required' });
    const assets = await store.find('assets', (a) => a.tenantId === tenantId && a.characterId === characterId);
    res.json(assets.map((a) => ({ id: a.id, uri: a.uri, prompt: a.prompt, provider: a.provider, model: a.model, createdAt: a.createdAt })));
  });

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const chat = createChatProvider();
  const image = createImageProvider();
  const app = createApp({ chat, image });
  app.listen(port, host, () => {
    console.log(`[${new Date().toISOString()}] OGZNSFW MVP listening on http://${host}:${port}`);
    console.log(`[${new Date().toISOString()}] chat provider: ${chat.provider ? chat.provider.name : 'NOT CONFIGURED - ' + chat.status.reason}`);
    console.log(`[${new Date().toISOString()}] image provider: ${image.provider ? image.provider.name : 'NOT CONFIGURED - ' + image.status.reason}`);
  });
}
