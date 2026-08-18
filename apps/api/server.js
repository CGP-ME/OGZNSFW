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
import { ReferencePackService } from '../../packages/character-core/reference-pack.js';
import { SceneService } from '../../packages/character-core/scene.js';
import { compileImageRequest } from '../../packages/providers/image/image-request.js';
import { MemoryStore, HeuristicMemoryExtractor } from '../../packages/memory/index.js';
import { createChatProvider, createImageProvider, registryInfo } from '../../packages/providers/registry.js';
import { checkText } from '../../packages/safety/index.js';
import { GenerationPipeline } from '../../packages/generation/pipeline.js';
import { seedDemo } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

export function createApp({ store, chat, image, imageValidator = null, presentationAssessor = null, galleryPolicy = {} } = {}) {
  store = store ?? new JsonStore(path.join(ROOT, 'db', 'data'));
  chat = chat ?? createChatProvider();
  image = image ?? createImageProvider();
  // imageValidator / presentationAssessor: no runtime implementations exist
  // yet (real CV validation and visual-quality models are later milestones);
  // when null, the endpoints return honest 503s.
  const characters = new CharacterService(store);
  const memories = new MemoryStore(store);
  const extractor = new HeuristicMemoryExtractor();
  const referencePacks = new ReferencePackService(store);
  const scenes = new SceneService(store, characters, referencePacks, galleryPolicy);

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

  // --- character reference packs (scoped tenant + character + exact version)
  app.post('/api/characters/:id/references', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const { version, assets } = req.body ?? {};
    if (!Number.isInteger(version) || !Array.isArray(assets)) return res.status(400).json({ error: 'integer version and assets array required' });
    const loaded = await characters.loadRecord(tenantId, req.params.id, version);
    if (!loaded) return res.status(404).json({ error: 'character version not found for this tenant' });
    try {
      const pack = await referencePacks.register(tenantId, req.params.id, version, assets);
      res.status(201).json({ characterId: req.params.id, version, assets: pack.assets });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/characters/:id/references', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const version = Number(req.query.version);
    if (!Number.isInteger(version)) return res.status(400).json({ error: 'integer version query param required' });
    const pack = await referencePacks.get(tenantId, req.params.id, version);
    res.json(pack ? pack.assets : []);
  });

  // --- scenes: create -> compile -> generate -> validate -> publish.
  // Every step is scoped by tenant and every refusal is explicit.
  app.post('/api/scenes', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const result = await scenes.create(tenantId, req.body ?? {});
    if (!result.ok) return res.status(422).json({ error: 'scene rejected', details: result.errors });
    res.status(201).json(result.scene);
  });

  app.get('/api/scenes', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    res.json(await scenes.list(tenantId));
  });

  app.get('/api/scenes/:id', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const scene = await scenes.get(tenantId, req.params.id);
    if (!scene) return res.status(404).json({ error: 'scene not found for this tenant' });
    res.json(scene);
  });

  async function compileForScene(tenantId, scene) {
    const records = {};
    for (const c of scene.characters) {
      records[c.characterId] = await characters.loadRecord(tenantId, c.characterId, c.characterVersion);
      if (!records[c.characterId]) throw new Error(`character ${c.characterId} v${c.characterVersion} no longer resolves for this tenant`);
    }
    return compileImageRequest(scene, records);
  }

  app.post('/api/scenes/:id/compile', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const scene = await scenes.get(tenantId, req.params.id);
    if (!scene) return res.status(404).json({ error: 'scene not found for this tenant' });
    try {
      res.json(await compileForScene(tenantId, scene));
    } catch (err) {
      res.status(422).json({ error: err.message });
    }
  });

  app.post('/api/scenes/:id/generate', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    if (!image.provider) return res.status(503).json({ error: 'no image provider configured', how: image.status.reason });
    if (!image.provider.supportsSceneRequests) {
      return res.status(501).json({ error: `image provider "${image.provider.name}" does not support structured multi-character scene requests`, note: 'scenes are never flattened into a single prompt' });
    }
    const scene = await scenes.get(tenantId, req.params.id);
    if (!scene) return res.status(404).json({ error: 'scene not found for this tenant' });
    try {
      const request = await compileForScene(tenantId, scene);
      const output = await image.provider.generateFromScene(request);
      await scenes.recordGeneration(tenantId, scene.id, { uri: output.uri, provider: output.provider, model: output.model, provenance: output.provenance ?? null, generatedAt: new Date().toISOString() });
      res.json({ status: 'generated', output: { provider: output.provider, model: output.model, provenance: output.provenance ?? null }, validationStatus: 'pending' });
    } catch (err) {
      console.log(`[${new Date().toISOString()}] scene generate failed tenant=${tenantId} scene=${scene.id}: ${err.message}`);
      res.status(502).json({ error: 'scene generation failed', detail: err.message });
    }
  });

  // Pipeline route: generate -> validate -> bounded deterministic seed retry.
  // The provider never retries; the pipeline owns attempts and provenance.
  app.post('/api/scenes/:id/generate-validated', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    if (!image.provider) return res.status(503).json({ error: 'no image provider configured', how: image.status.reason });
    if (!image.provider.supportsSceneRequests) {
      return res.status(501).json({ error: `image provider "${image.provider.name}" does not support structured scene requests` });
    }
    const scene = await scenes.get(tenantId, req.params.id);
    if (!scene) return res.status(404).json({ error: 'scene not found for this tenant' });
    try {
      const request = await compileForScene(tenantId, scene);
      const pipeline = new GenerationPipeline({ provider: image.provider, identityValidator: imageValidator });
      const run = await pipeline.run(request);
      const attemptLog = run.provenance?.attempts ?? [];
      if (run.ok && run.selected) {
        await scenes.recordGeneration(tenantId, scene.id, { ...run.selected.output, generatedAt: new Date().toISOString(), pipeline: run.provenance });
        if (!run.pendingValidation) {
          await scenes.applyValidationReport(tenantId, scene.id, run.selected.validation.report);
        }
        return res.json({
          status: run.pendingValidation ? 'generated (needs human review - no validator configured)' : 'validated',
          attemptsUsed: attemptLog.length,
          maxAttempts: run.provenance.policy.maxAttempts,
          attempts: attemptLog,
          selectedAttempt: run.provenance.selectedAttempt,
          finalVerdict: scenes.finalVerdict(await scenes.get(tenantId, scene.id)),
        });
      }
      // Failure: retain attempts as unpublished evidence on the scene record
      await scenes.recordFailedRun(tenantId, scene.id, run.provenance, run.reason);
      return res.status(422).json({
        error: 'generation rejected before publication',
        reason: run.reason,
        attemptsUsed: attemptLog.length,
        maxAttempts: run.provenance?.policy?.maxAttempts ?? null,
        attempts: attemptLog,
      });
    } catch (err) {
      console.log(`[${new Date().toISOString()}] pipeline run failed tenant=${tenantId} scene=${scene.id}: ${err.message}`);
      res.status(502).json({ error: 'pipeline errored', detail: err.message });
    }
  });

  app.post('/api/scenes/:id/validate', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    if (!imageValidator) {
      return res.status(503).json({ error: 'no image validator configured', note: 'real computer-vision validation does not exist yet; deterministic validators can be injected for testing' });
    }
    const scene = await scenes.get(tenantId, req.params.id);
    if (!scene) return res.status(404).json({ error: 'scene not found for this tenant' });
    if (!scene.generation?.lastOutput) return res.status(409).json({ error: 'nothing generated for this scene yet' });
    try {
      const request = await compileForScene(tenantId, scene);
      const report = await imageValidator.validate({ request, asset: scene.generation.lastOutput });
      const applied = await scenes.applyValidationReport(tenantId, scene.id, report);
      const payload = { validationStatus: applied.validationStatus, verdict: applied.verdict, report };
      if (applied.validationStatus === 'passed') return res.json(payload);
      return res.status(422).json({ ...payload, error: 'validation failed', reasons: applied.verdict.reasons });
    } catch (err) {
      res.status(500).json({ error: 'validation errored', detail: err.message });
    }
  });

  app.post('/api/scenes/:id/presentation', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    if (!presentationAssessor) {
      return res.status(503).json({ error: 'no presentation-quality assessor configured', note: 'no real visual-quality model exists yet; human review is required' });
    }
    const scene = await scenes.get(tenantId, req.params.id);
    if (!scene) return res.status(404).json({ error: 'scene not found for this tenant' });
    if (!scene.generation?.lastOutput) return res.status(409).json({ error: 'nothing generated for this scene yet' });
    try {
      const request = await compileForScene(tenantId, scene);
      const report = await presentationAssessor.assess({ request, asset: scene.generation.lastOutput, identityReport: scene.generation.validation?.report ?? null });
      const applied = await scenes.applyPresentationReport(tenantId, scene.id, report);
      res.json({ presentation: { verdict: applied.verdict, warnings: applied.warnings, reasons: applied.reasons }, finalVerdict: scenes.finalVerdict(await scenes.get(tenantId, scene.id)) });
    } catch (err) {
      res.status(500).json({ error: 'presentation assessment errored', detail: err.message });
    }
  });

  app.post('/api/scenes/:id/approve', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const scene = await scenes.get(tenantId, req.params.id);
    if (!scene) return res.status(404).json({ error: 'scene not found for this tenant' });
    const { approvedBy } = req.body ?? {};
    const result = await scenes.approveForGallery(tenantId, req.params.id, approvedBy);
    if (!result.ok) return res.status(400).json({ error: result.errors.join('; ') });
    res.json({ approved: true, finalVerdict: scenes.finalVerdict(await scenes.get(tenantId, req.params.id)) });
  });

  app.get('/api/scenes/:id/verdict', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const scene = await scenes.get(tenantId, req.params.id);
    if (!scene) return res.status(404).json({ error: 'scene not found for this tenant' });
    res.json({
      finalVerdict: scenes.finalVerdict(scene),
      axes: {
        identity: scene.validationStatus,
        technical: (!!scene.generation?.lastOutput && scene.generation.status !== 'failed') ? 'ok' : 'not ok',
        presentation: scene.presentation ? scene.presentation.verdict : 'not assessed',
        humanApproval: scene.humanApproval?.approved ? `approved by ${scene.humanApproval.approvedBy}` : 'not approved',
      },
    });
  });

  app.post('/api/scenes/:id/publish', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    const scene = await scenes.get(tenantId, req.params.id);
    if (!scene) return res.status(404).json({ error: 'scene not found for this tenant' });
    if (!scene.generation?.lastOutput) return res.status(409).json({ error: 'nothing generated for this scene yet' });
    const result = await scenes.publishAsset(tenantId, scene.id, scene.generation.lastOutput);
    if (!result.ok) return res.status(409).json({ error: 'publication refused', verdict: result.verdict ?? null, details: result.errors });
    res.status(201).json({ published: true, asset: { id: result.asset.id, uri: result.asset.uri, provenance: result.asset.provenance } });
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
