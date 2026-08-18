// ComfyUIImageProvider - the first scene-capable real image backend.
// Template-fills the proven Phase 1 workflow shape (SDXL + per-character
// IPAdapter chains with regional attention masks) from a structured
// multi-character-image-request. Never collapses a scene into one free-form
// prompt: per-character conditioning is carried by per-character reference
// chains plus per-character region-masked text conditioning.
//
// Success is claimed only after: workflow accepted -> prompt queued ->
// execution completed -> output retrieved as non-empty bytes.
import { createHash } from 'node:crypto';
import { ImageProvider } from './index.js';

// Conservative defaults taken from the successful Phase 1 two-character run,
// plus the first seam/background remedies (feather + overlap) at low values.
export const comfyuiTuningDefaults = {
  checkpoint: 'sd_xl_base_1.0.safetensors',
  steps: 30,
  cfg: 6.5,
  width: 1024,
  height: 1024,
  seed: null,                    // null -> deterministic seed derived from sceneId
  // Feather/overlap default to the PROVEN Phase 1 values (0/0). A smoke run
  // with feather 40 / overlap 32 produced a character MERGE (one figure
  // blending both identities) - blended attention regions trade identity
  // separation for seam smoothing. These stay exposed as tuning knobs for the
  // benchmark lane; do not raise the defaults without benchmark evidence.
  // Benchmark 2026-08-18 (park scene, 2 seeds x 4 variants + editorial
  // confirm): feather 48 keeps both identities intact with a visibly softer
  // boundary than feather 0; feather 96/overlap 32 re-merges; weight 0.65
  // degrades identity. Winner: feather 48, overlap 0, weight 0.8.
  maskFeather: 48,
  maskOverlap: 0,
  adapterWeight: 0.8,
  adapterWeightType: 'linear',
  backgroundConditioningStrength: 1.0, // strength of scene-level text conditioning
  // Benchmark evidence (2026-08-18, 12 runs): region-masked per-character
  // TEXT conditioning drives single-figure merges in single-pass SDXL - every
  // merged run had it on, both two-figure successes had it off, and wardrobe
  // still transferred via the reference images. Default 0 (no such nodes);
  // wardrobe/pose remain in the structured request for the future multi-pass
  // refinement stage. Raise only with benchmark evidence.
  characterTextStrength: 0,
  ipadapterPreset: 'PLUS (high strength)',
  // Pipeline mode: 'single-pass' is the benchmarked baseline (regression-
  // pinned). 'two-pass' composes the scene from text first (no identity
  // conditioning -> background belongs to the setting), then refines each
  // character's region independently with only that character's reference -
  // the background-leakage/composition lane.
  pipelineMode: 'single-pass',
  refineDenoise: 0.6,
  refineSteps: 22,
  pollIntervalMs: 2000,
  timeoutMs: 240000,
};

// Default HTTP client (real network). Tests inject a fake with the same shape.
export class ComfyHttpClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }
  async getJson(path) {
    const res = await fetch(this.baseUrl + path, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`ComfyUI GET ${path} -> HTTP ${res.status}`);
    return res.json();
  }
  async postJson(path, body) {
    const res = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`ComfyUI POST ${path} -> HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  }
  async getBytes(path) {
    const res = await fetch(this.baseUrl + path, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`ComfyUI GET ${path} -> HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

// Deterministic 32-bit seed from a scene id.
export function seedFromSceneId(sceneId) {
  const h = createHash('sha256').update(String(sceneId)).digest();
  return h.readUInt32BE(0);
}

// Resolve a reference asset ref (asset://name) to a ComfyUI input filename.
// The default maps asset://<name> -> <name>.png inside ComfyUI's input dir.
// A custom resolver may be injected; unresolvable refs throw - references are
// never silently dropped.
function defaultReferenceResolver(ref) {
  const m = /^asset:\/\/([A-Za-z0-9._-]+)$/.exec(ref);
  if (!m) return null;
  return `${m[1]}.png`;
}

export class ComfyUIImageProvider extends ImageProvider {
  constructor(baseUrl, opts = {}) {
    super();
    if (!baseUrl) throw new Error('ComfyUIImageProvider requires a base URL (COMFYUI_URL)');
    this.baseUrl = baseUrl;
    this.client = opts.client ?? new ComfyHttpClient(baseUrl);
    this.tuning = { ...comfyuiTuningDefaults, ...(opts.tuning ?? {}) };
    this.resolveReference = opts.referenceResolver ?? defaultReferenceResolver;
  }

  get name() { return 'comfyui'; }
  get supportsSceneRequests() { return true; }

  async probe() {
    try {
      const stats = await this.client.getJson('/system_stats');
      return { reachable: true, detail: `ComfyUI ${stats.system?.comfyui_version ?? 'unknown version'}` };
    } catch (err) {
      return { reachable: false, detail: err.message };
    }
  }

  // Single-subject generation (legacy interface path), same engine.
  async generate({ prompt, characterRecord }) {
    const a = characterRecord?.appearance ?? {};
    const desc = [a.hair && `${a.hair} hair`, a.eyes && `${a.eyes} eyes`, a.build, a.style].filter(Boolean).join(', ');
    const t = this.tuning;
    const workflow = {
      4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: t.checkpoint } },
      5: { class_type: 'EmptyLatentImage', inputs: { width: t.width, height: t.height, batch_size: 1 } },
      6: { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: `${prompt}${desc ? '. ' + desc : ''}` } },
      7: { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: 'blurry, deformed, extra limbs, low quality, cartoon, child, teenager' } },
      3: { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], seed: t.seed ?? seedFromSceneId(prompt), steps: t.steps, cfg: t.cfg, sampler_name: 'euler', scheduler: 'normal', denoise: 1.0 } },
      8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      9: { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'ogznsfw_single' } },
    };
    return this.executeWorkflow(workflow, { seed: workflow[3].inputs.seed, characterVersions: {}, referenceAssets: [] });
  }

  // Build the multi-character workflow from a structured scene request.
  // overrides.seed lets the pipeline drive deterministic retry seeds; the
  // provider itself NEVER retries (pipeline owns attempts).
  buildSceneWorkflow(request, overrides = {}) {
    if (request?.kind !== 'multi-character-image-request' || !request.characters?.length) {
      throw new Error('malformed scene request: expected multi-character-image-request with characters');
    }
    const t = this.tuning;
    const n = request.characters.length;
    const seed = overrides.seed ?? t.seed ?? seedFromSceneId(request.sceneId);
    const wf = {
      4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: t.checkpoint } },
      10: { class_type: 'IPAdapterUnifiedLoader', inputs: { model: ['4', 0], preset: t.ipadapterPreset } },
      5: { class_type: 'EmptyLatentImage', inputs: { width: t.width, height: t.height, batch_size: 1 } },
    };

    // Scene-level conditioning (setting/composition only - never character text)
    const s = request.scene ?? {};
    // Subject phrase LEADS the prompt and uses SPECIFIC human nouns derived
    // from the cast's canonical genders. Benchmark evidence (2026-08-18):
    // with identical masks, seed, and graph, "two separate people" collapsed
    // to a single merged figure while "two adult women" composed two figures.
    // Generic subject nouns lose to the reference-image pull; specific ones
    // hold composition. Word choice here is load-bearing.
    const genders = request.characters.map((c) => c.identity?.gender ?? null);
    const countWord = n === 2 ? 'two' : String(n);
    let noun;
    if (n === 1) noun = genders[0] === 'female' ? 'an adult woman' : genders[0] === 'male' ? 'an adult man' : 'an adult';
    else if (genders.every((g) => g === 'female')) noun = `${countWord} adult women`;
    else if (genders.every((g) => g === 'male')) noun = `${countWord} adult men`;
    else noun = `${countWord} adults`;
    const subjectPhrase = n > 1 ? `photograph of ${noun} standing side by side` : `photograph of ${noun}`;
    const sceneText = [
      subjectPhrase,
      Object.values(s.setting ?? {}).filter((v) => typeof v === 'string').join(', '),
      Object.values(s.composition ?? {}).filter((v) => typeof v === 'string').join(', '),
      'all faces clearly visible, photorealistic',
    ].filter(Boolean).join(', ');
    wf[6] = { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: sceneText } };
    wf[7] = { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: 'blurry, deformed, extra limbs, low quality, cartoon, child, teenager, merged faces, identical twins, same person twice' } };

    // Per-character chains: region mask (overlap + feather) + IPAdapter ref +
    // region-masked wardrobe/pose text. Regions are vertical slices in
    // character order; sceneRole text stays with its character.
    const slice = Math.floor(t.width / n);
    let modelInput = ['10', 0];
    let positiveCond = ['6', 0];
    let nodeId = 100;
    const referenceAssets = [];
    const characterVersions = {};

    request.characters.forEach((c, i) => {
      characterVersions[c.characterId] = c.characterVersion;
      const ref = (c.referenceAssets ?? [])[0];
      if (!ref) throw new Error(`character ${c.characterId} has no reference asset; identity-locked generation requires one`);
      const filename = this.resolveReference(ref);
      if (!filename) throw new Error(`reference asset "${ref}" cannot be resolved to an input image`);
      referenceAssets.push(ref);

      const x = Math.max(0, i * slice - t.maskOverlap);
      const w = Math.min(t.width - x, slice + 2 * t.maskOverlap);
      const idBase = nodeId; nodeId += 10;
      wf[idBase] = { class_type: 'SolidMask', inputs: { value: 0.0, width: t.width, height: t.height } };
      wf[idBase + 1] = { class_type: 'SolidMask', inputs: { value: 1.0, width: w, height: t.height } };
      wf[idBase + 2] = { class_type: 'MaskComposite', inputs: { destination: [String(idBase), 0], source: [String(idBase + 1), 0], x, y: 0, operation: 'add' } };
      let maskOut = [String(idBase + 2), 0];
      if (t.maskFeather > 0) {
        wf[idBase + 3] = { class_type: 'FeatherMask', inputs: { mask: maskOut, left: t.maskFeather, top: 0, right: t.maskFeather, bottom: 0 } };
        maskOut = [String(idBase + 3), 0];
      }
      wf[idBase + 4] = { class_type: 'LoadImage', inputs: { image: filename } };
      wf[idBase + 5] = { class_type: 'IPAdapterAdvanced', inputs: {
        model: modelInput, ipadapter: ['10', 1], image: [String(idBase + 4), 0], attn_mask: maskOut,
        weight: t.adapterWeight, weight_type: t.adapterWeightType, combine_embeds: 'concat',
        start_at: 0.0, end_at: 1.0, embeds_scaling: 'V only',
      } };
      modelInput = [String(idBase + 5), 0];

      // sceneRole is deliberately NOT text-conditioned: region placement is
      // expressed by the mask geometry. Benchmark evidence (2026-08-18):
      // masked role-words like "left foreground" collapsed composition into a
      // single merged figure across four runs; removing them restored the
      // proven Phase 1 behavior. Only wardrobe/pose are region-conditioned,
      // prefixed with a person-noun for coherence, and strength 0 emits no
      // nodes at all.
      const charText = [c.wardrobe, c.poseAction].filter(Boolean).join(', ');
      if (charText && t.characterTextStrength > 0) {
        wf[idBase + 6] = { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: `person wearing ${charText}` } };
        wf[idBase + 7] = { class_type: 'ConditioningSetMask', inputs: { conditioning: [String(idBase + 6), 0], mask: maskOut, strength: t.characterTextStrength, set_cond_area: 'default' } };
        wf[idBase + 8] = { class_type: 'ConditioningCombine', inputs: { conditioning_1: positiveCond, conditioning_2: [String(idBase + 7), 0] } };
        positiveCond = [String(idBase + 8), 0];
      }
    });

    wf[3] = { class_type: 'KSampler', inputs: { model: modelInput, positive: positiveCond, negative: ['7', 0], latent_image: ['5', 0], seed, steps: t.steps, cfg: t.cfg, sampler_name: 'euler', scheduler: 'normal', denoise: 1.0 } };
    wf[8] = { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } };
    wf[9] = { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: `ogznsfw_scene_${String(request.sceneId).slice(0, 8)}` } };
    return { workflow: wf, seed, referenceAssets, characterVersions };
  }

  async generateFromScene(request, overrides = {}) {
    const build = (this.tuning.pipelineMode === 'two-pass')
      ? this.buildTwoPassWorkflow(request, overrides)
      : this.buildSceneWorkflow(request, overrides);
    const { workflow, seed, referenceAssets, characterVersions } = build;
    return this.executeWorkflow(workflow, { seed, characterVersions, referenceAssets, sceneId: request.sceneId });
  }

  // Two-pass compositor: pass 1 = base scene from text only (identity-free,
  // so the setting owns the background and composition follows the subject
  // phrase); pass 2..n+1 = per-character regional refinement, each with a
  // latent noise mask over that character's region and ONLY that character's
  // IPAdapter chain (no cross-character model chaining at all).
  buildTwoPassWorkflow(request, overrides = {}) {
    if (request?.kind !== 'multi-character-image-request' || !request.characters?.length) {
      throw new Error('malformed scene request: expected multi-character-image-request with characters');
    }
    const t = this.tuning;
    const n = request.characters.length;
    const seed = overrides.seed ?? t.seed ?? seedFromSceneId(request.sceneId);
    const wf = {
      4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: t.checkpoint } },
      5: { class_type: 'EmptyLatentImage', inputs: { width: t.width, height: t.height, batch_size: 1 } },
    };
    // Shared text conditioning (same subject-noun rules as single-pass)
    const s = request.scene ?? {};
    const genders = request.characters.map((c) => c.identity?.gender ?? null);
    const countWord = n === 2 ? 'two' : String(n);
    let noun;
    if (n === 1) noun = genders[0] === 'female' ? 'an adult woman' : genders[0] === 'male' ? 'an adult man' : 'an adult';
    else if (genders.every((g) => g === 'female')) noun = `${countWord} adult women`;
    else if (genders.every((g) => g === 'male')) noun = `${countWord} adult men`;
    else noun = `${countWord} adults`;
    const sceneText = [
      n > 1 ? `photograph of ${noun} standing side by side` : `photograph of ${noun}`,
      Object.values(s.setting ?? {}).filter((v) => typeof v === 'string').join(', '),
      Object.values(s.composition ?? {}).filter((v) => typeof v === 'string').join(', '),
      'all faces clearly visible, photorealistic',
    ].filter(Boolean).join(', ');
    wf[6] = { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: sceneText } };
    wf[7] = { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: 'blurry, deformed, extra limbs, low quality, cartoon, child, teenager, merged faces, identical twins, same person twice' } };

    // Pass 1: identity-free base scene
    wf[30] = { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], seed, steps: t.steps, cfg: t.cfg, sampler_name: 'euler', scheduler: 'normal', denoise: 1.0 } };
    let latent = ['30', 0];

    // Loader shared; each character pass builds its OWN model branch
    wf[10] = { class_type: 'IPAdapterUnifiedLoader', inputs: { model: ['4', 0], preset: t.ipadapterPreset } };
    const slice = Math.floor(t.width / n);
    let nodeId = 100;
    const referenceAssets = [];
    const characterVersions = {};

    request.characters.forEach((c, i) => {
      characterVersions[c.characterId] = c.characterVersion;
      const ref = (c.referenceAssets ?? [])[0];
      if (!ref) throw new Error(`character ${c.characterId} has no reference asset; identity-locked generation requires one`);
      const filename = this.resolveReference(ref);
      if (!filename) throw new Error(`reference asset "${ref}" cannot be resolved to an input image`);
      referenceAssets.push(ref);

      const x = Math.max(0, i * slice - t.maskOverlap);
      const w = Math.min(t.width - x, slice + 2 * t.maskOverlap);
      const idBase = nodeId; nodeId += 10;
      wf[idBase] = { class_type: 'SolidMask', inputs: { value: 0.0, width: t.width, height: t.height } };
      wf[idBase + 1] = { class_type: 'SolidMask', inputs: { value: 1.0, width: w, height: t.height } };
      wf[idBase + 2] = { class_type: 'MaskComposite', inputs: { destination: [String(idBase), 0], source: [String(idBase + 1), 0], x, y: 0, operation: 'add' } };
      let maskOut = [String(idBase + 2), 0];
      if (t.maskFeather > 0) {
        wf[idBase + 3] = { class_type: 'FeatherMask', inputs: { mask: maskOut, left: t.maskFeather, top: 0, right: t.maskFeather, bottom: 0 } };
        maskOut = [String(idBase + 3), 0];
      }
      wf[idBase + 4] = { class_type: 'LoadImage', inputs: { image: filename } };
      // Independent model branch: only THIS character's reference
      wf[idBase + 5] = { class_type: 'IPAdapterAdvanced', inputs: {
        model: ['10', 0], ipadapter: ['10', 1], image: [String(idBase + 4), 0], attn_mask: maskOut,
        weight: t.adapterWeight, weight_type: t.adapterWeightType, combine_embeds: 'concat',
        start_at: 0.0, end_at: 1.0, embeds_scaling: 'V only',
      } };
      // Regional refinement: latent noise mask scopes the repaint to the region
      wf[idBase + 6] = { class_type: 'SetLatentNoiseMask', inputs: { samples: latent, mask: maskOut } };
      wf[idBase + 7] = { class_type: 'KSampler', inputs: {
        model: [String(idBase + 5), 0], positive: ['6', 0], negative: ['7', 0], latent_image: [String(idBase + 6), 0],
        seed: seed + 1000 + i, steps: t.refineSteps, cfg: t.cfg, sampler_name: 'euler', scheduler: 'normal', denoise: t.refineDenoise,
      } };
      latent = [String(idBase + 7), 0];
    });

    wf[8] = { class_type: 'VAEDecode', inputs: { samples: latent, vae: ['4', 2] } };
    wf[9] = { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: `ogznsfw_scene2p_${String(request.sceneId).slice(0, 8)}` } };
    return { workflow: wf, seed, referenceAssets, characterVersions };
  }

  // Queue -> poll -> retrieve. Throws at every failure point; success only
  // with real retrieved bytes.
  async executeWorkflow(workflow, meta) {
    const workflowHash = createHash('sha256').update(JSON.stringify(workflow)).digest('hex');
    let comfyuiVersion = null;
    try { comfyuiVersion = (await this.client.getJson('/system_stats')).system?.comfyui_version ?? null; }
    catch (err) { throw new Error(`ComfyUI unreachable at ${this.baseUrl}: ${err.message}`); }

    const queued = await this.client.postJson('/prompt', { prompt: workflow });
    if (queued.node_errors && Object.keys(queued.node_errors).length > 0) {
      throw new Error('ComfyUI rejected the workflow: ' + JSON.stringify(queued.node_errors));
    }
    if (!queued.prompt_id) throw new Error('ComfyUI did not return a prompt_id; queue failed');

    const t = this.tuning;
    const deadline = Date.now() + t.timeoutMs;
    let entry = null;
    while (Date.now() < deadline) {
      const history = await this.client.getJson(`/history/${queued.prompt_id}`);
      entry = history?.[queued.prompt_id];
      if (entry?.status?.completed) break;
      if (entry?.status?.status_str === 'error') {
        throw new Error('ComfyUI execution failed: ' + JSON.stringify(entry.status.messages ?? []).slice(0, 500));
      }
      await new Promise((r) => setTimeout(r, t.pollIntervalMs));
    }
    if (!entry?.status?.completed) throw new Error(`ComfyUI generation timed out after ${t.timeoutMs}ms`);

    const images = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? []);
    if (!images.length) throw new Error('ComfyUI completed but produced no output images');
    const img = images[0];
    const bytes = await this.client.getBytes(`/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${encodeURIComponent(img.type ?? 'output')}`);
    if (!bytes?.length) throw new Error('ComfyUI output retrieval returned empty bytes');

    return {
      uri: `data:image/png;base64,${bytes.toString('base64')}`,
      provider: this.name,
      model: t.checkpoint,
      provenance: {
        provider: this.name,
        comfyuiVersion,
        workflowHash,
        seed: meta.seed,
        checkpoint: t.checkpoint,
        characterVersions: meta.characterVersions,
        referenceAssets: meta.referenceAssets,
        outputFilename: img.filename,
        promptId: queued.prompt_id,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
