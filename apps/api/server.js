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
import { CONFIG } from '../../packages/config/index.js';
import { validateCapabilities } from '../../packages/providers/capabilities.js';
import { seedDemo } from './seed.js';

// ---------------------------------------------------------------------------
// PROCESS FAILURE POLICY (DOCTRINE rule 1, corrected 2026-08-19 by Trey)
//
// A request failure and an unknown process-level failure are NOT the same
// event and must not share a policy:
//
//   known request failure  -> route boundary returns a typed 4xx/5xx, the
//                             process keeps serving; runtime is still sound.
//   unknown process fault  -> we CANNOT prove the runtime is sound. The
//                             process stays alive (rule 1: only Trey and the
//                             kill switch stop it) but it must NEVER report
//                             healthy afterwards. It marks itself DEGRADED,
//                             refuses new API work by name with the fatal
//                             evidence attached, and waits for an operator.
//
// Staying alive-but-degraded is chosen over shutdown so the operator can
// inspect a live process; it is explicitly NOT "continue as if healthy".
// ---------------------------------------------------------------------------
const processHealth = { degraded: false, faults: [] };
export function markProcessDegraded(kind, reason) {
  const fault = { kind, detail: reason?.stack ?? String(reason), at: new Date().toISOString() };
  processHealth.degraded = true;
  processHealth.faults.push(fault);
  console.error('!'.repeat(72));
  console.error(`[${fault.at}] ${kind} ESCAPED ALL BOUNDARIES - runtime soundness can no longer be proven.`);
  console.error(fault.detail);
  console.error('  Process stays alive per doctrine (only Trey/kill switch stop it) but is now DEGRADED:');
  console.error('  API work is refused by name. It will NOT report healthy. Operator action required.');
  console.error('!'.repeat(72));
  return fault;
}
export function processHealthSnapshot() {
  return { degraded: processHealth.degraded, faults: processHealth.faults.map((f) => ({ kind: f.kind, at: f.at })) };
}
export function resetProcessHealthForTests() {
  processHealth.degraded = false;
  processHealth.faults.length = 0;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// DOCTRINE: no implicit construction. Every dependency is supplied by the
// caller, so what the app is running with is always exactly what the caller
// stated. imageValidator and presentationAssessor must be passed explicitly -
// pass null to declare "none configured" (the endpoints then return honest
// 503s); omitting them is an error, not a silent "none".
export function createApp(deps) {
  // DOCTRINE rule 2: no throws. Rule 6: never cage the machine - filter what
  // routes through it. An unstated dependency is not invented and does not
  // kill the app: it is named, screamed, and the capabilities that need it
  // are quarantined. Every other route keeps working.
  const supplied = (deps && typeof deps === 'object') ? deps : {};
  const unstated = ['store', 'chat', 'image', 'imageValidator', 'presentationAssessor', 'galleryPolicy'].filter((k) => !(k in supplied));
  // LOUD REFUSAL AT THE BEGINNING: every capability we are refusing to serve
  // is named once, up front, at construction - not discovered later when a
  // request happens to hit it.
  const refusals = unstated.map((k) => ({ capability: k, reason: 'not stated by caller; never defaulted' }));
  if (refusals.length) {
    console.error('='.repeat(72));
    console.error(`[${new Date().toISOString()}] REFUSED AT STARTUP - ${refusals.length} capability/capabilities will not be served:`);
    for (const r of refusals) console.error(`  REFUSED: ${r.capability} - ${r.reason}`);
    console.error('  Everything else runs. Routes needing a refused capability answer by name.');
    console.error('='.repeat(72));
  }
  let { store, chat, image, imageValidator, presentationAssessor, galleryPolicy } = supplied;

  // CAPABILITY GATE for injected components. The registry gates providers it
  // constructs; anything handed in directly is gated here - same contract,
  // same refusal, so no implementation reaches an abstract stub at runtime.
  const gate = (kind, instance, label) => {
    if (!instance) return null;
    const result = validateCapabilities(kind, instance);
    if (result.ok) return instance;
    console.error(`[${new Date().toISOString()}] REFUSED AT STARTUP - ${result.detail}. ${label} is quarantined; routes needing it answer by name.`);
    refusals.push({ capability: label, reason: result.detail, missingCapabilities: result.missing });
    return null;
  };
  imageValidator = gate('imageValidator', imageValidator, 'imageValidator');
  presentationAssessor = gate('presentationAssessor', presentationAssessor, 'presentationAssessor');
  if (chat?.provider && !gate('chatProvider', chat.provider, 'chat')) {
    chat = { provider: null, status: { configured: false, selected: chat.status?.selected ?? null, reason: 'chat provider refused at startup: does not satisfy the ChatProvider contract' } };
  }
  if (image?.provider && !gate('imageProvider', image.provider, 'image')) {
    image = { provider: null, status: { configured: false, selected: image.status?.selected ?? null, reason: 'image provider refused at startup: does not satisfy the ImageProvider contract' } };
  }

  const characters = new CharacterService(store);
  const memories = new MemoryStore(store);
  const extractor = new HeuristicMemoryExtractor();
  const referencePacks = new ReferencePackService(store);
  const scenes = new SceneService(store, characters, referencePacks, galleryPolicy);

  const app = express();
  // The startup refusal set is readable, not just logged - callers and
  // operators see what was refused without hitting a route to find out.
  app.locals.refusals = refusals;

  // ---------------------------------------------------------------------
  // REQUEST ERROR BOUNDARY (DOCTRINE rule 1: never process death)
  //
  // PROVEN 2026-08-19 on express 4.22.2 + node 22: express does not await
  // async handlers, so a throw escaping any handler becomes an unhandled
  // rejection and Node TERMINATES THE PROCESS. That is a process-death path
  // reachable from a single bad request.
  //
  // This is the upstream fix (fourth shape): rather than chasing every
  // individual throw downstream, the boundary lives here, once. An escaped
  // throw quarantines THAT REQUEST - typed error preserved, loud evidence
  // emitted, 500 returned - and the process survives. Cell, never organism.
  // ---------------------------------------------------------------------
  const guard = (handler) => async function boundaried(req, res, next) {
    try {
      await handler(req, res, next);
    } catch (err) {
      const errorType = err?.constructor?.name ?? 'Error';
      console.error(`[${new Date().toISOString()}] REQUEST QUARANTINED ${req.method} ${req.originalUrl} - ${errorType}: ${err?.message}`);
      console.error(err?.stack ?? '(no stack)');
      if (!res.headersSent) {
        res.status(500).json({
          error: 'request quarantined - an internal failure escaped its handler',
          errorType,
          detail: err?.message ?? String(err),
          note: 'this request failed; the service remains running',
        });
      }
    }
  };
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const original = app[method].bind(app);
    app[method] = (routePath, ...handlers) => original(routePath, ...handlers.map((h) => (typeof h === 'function' && h.length < 4 ? guard(h) : h)));
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(ROOT, 'apps', 'web')));

  // Store is the one dependency every data route needs. If it was never
  // stated, those routes refuse by name (503) - loudly, per request, with
  // the static app still served. Nothing is invented, nothing dies.
  app.use('/api', (req, res, next) => {
    // The health surface must stay reachable precisely when the service is
    // degraded - that is when an operator needs it. It is the one route the
    // degraded refusal does not intercept.
    if (req.path === '/health') return next();
    // A degraded process never serves API work as if healthy. The fatal
    // evidence travels with the refusal.
    if (processHealth.degraded) {
      return res.status(503).json({
        error: 'service degraded - an unknown failure escaped all boundaries',
        detail: 'runtime soundness cannot be proven; API work is refused until an operator clears this',
        faults: processHealthSnapshot().faults,
      });
    }
    if (!store) {
      return res.status(503).json({ error: 'data store not configured', detail: 'createApp was called without an explicit "store" - this capability is quarantined, not defaulted' });
    }
    next();
  });

  // Health is honest by construction: it reports degraded state rather than
  // 200-OK-while-broken, and it stays reachable when API work is refused.
  app.get('/api/health', (req, res) => {
    const health = processHealthSnapshot();
    res.status(health.degraded ? 503 : 200).json({
      status: health.degraded ? 'degraded' : 'ok',
      refusedAtStartup: refusals,
      faults: health.faults,
    });
  });

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
    // A dependency explicitly declared null is a stated "none configured",
    // not a crash. Describe it honestly instead of dereferencing it.
    const describe = (dep, name) => (dep
      ? { ...dep.status, provider: dep.provider ? dep.provider.name : null }
      : { configured: false, selected: null, provider: null, reason: `${name} was not stated at startup - refused, never defaulted` });
    const out = {
      refusedAtStartup: refusals,
      registry: registryInfo(),
      chat: describe(chat, 'chat'),
      image: describe(image, 'image'),
    };
    if (probe) {
      out.chat.probe = chat?.provider ? await chat.provider.probe() : { reachable: false, detail: out.chat.reason };
      out.image.probe = image?.provider ? await image.provider.probe() : { reachable: false, detail: out.image.reason };
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
    if (!chat?.provider) {
      return res.status(503).json({ error: 'no chat provider configured', how: chat?.status?.reason ?? 'chat was not stated at startup - refused, never defaulted' });
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
    const refusedMemories = [];
    for (const cand of extracted) {
      const r = await memories.save(tenantId, characterId, cand);
      // A refusal is named in the response, never dropped into undefined.
      if (r?.ok === false) refusedMemories.push({ candidate: cand.content, errors: r.errors });
      else saved.push(r);
    }

    res.json({
      reply: result.reply, provider: result.provider, model: result.model,
      usedMemories: relevant.map((m) => m.content),
      newMemories: saved.map((m) => m.content),
      ...(refusedMemories.length ? { refusedMemories } : {}),
    });
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
    const saved = await memories.save(tenantId, characterId, { kind, content, importance });
    if (saved?.ok === false) return res.status(400).json({ error: 'memory refused', details: saved.errors });
    res.status(201).json(saved);
  });

  // --- images: safety gate -> provider -> private asset record
  app.post('/api/assets', async (req, res) => {
    const tenantId = requireTenant(req, res); if (!tenantId) return;
    if (!image?.provider) {
      return res.status(503).json({ error: 'no image provider configured', how: image?.status?.reason ?? 'image was not stated at startup - refused, never defaulted' });
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
    const pack = await referencePacks.register(tenantId, req.params.id, version, assets);
    if (pack?.ok === false) return res.status(400).json({ error: 'reference pack refused', details: pack.errors });
    res.status(201).json({ characterId: req.params.id, version, assets: pack.assets });
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
    if (!image?.provider) return res.status(503).json({ error: 'no image provider configured', how: image?.status?.reason ?? 'image was not stated at startup - refused, never defaulted' });
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
    if (!image?.provider) return res.status(503).json({ error: 'no image provider configured', how: image?.status?.reason ?? 'image was not stated at startup - refused, never defaulted' });
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
  // PROCESS-LEVEL BOUNDARY (DOCTRINE rule 1). Node terminates on unhandled
  // rejections by default. Anything that escapes the request boundary is
  // screamed here and the process stays up; only Trey stops this service.
  // Installed only for the real server - tests must not mute their own
  // failures.
  process.on('unhandledRejection', (reason) => markProcessDegraded('UNHANDLED REJECTION', reason));
  process.on('uncaughtException', (err) => markProcessDegraded('UNCAUGHT EXCEPTION', err));

  const port = Number(process.env.PORT || CONFIG.server.port);
  const host = process.env.HOST || CONFIG.server.host;
  const chat = createChatProvider();
  const image = createImageProvider();
  const app = createApp({
    store: new JsonStore(path.join(ROOT, 'db', 'data')),
    chat,
    image,
    // No real CV identity validator and no visual-quality model exist. These
    // are declared null explicitly - the endpoints return honest 503s and
    // nothing publishes without human approval (see galleryPolicy).
    imageValidator: null,
    presentationAssessor: null,
    galleryPolicy: CONFIG.gallery,
  });
  app.listen(port, host, () => {
    console.log(`[${new Date().toISOString()}] OGZNSFW MVP listening on http://${host}:${port}`);
    console.log(`[${new Date().toISOString()}] chat provider: ${chat?.provider ? chat.provider.name : 'NOT CONFIGURED - ' + (chat?.status?.reason ?? 'not stated')}`);
    console.log(`[${new Date().toISOString()}] image provider: ${image?.provider ? image.provider.name : 'NOT CONFIGURED - ' + (image?.status?.reason ?? 'not stated')}`);
  });
}
