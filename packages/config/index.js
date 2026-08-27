// THE config. Doctrine: every knob, threshold, policy, and default lives
// here - one spot, not scattered across the files that use them. Modules
// import from here; they do not define their own defaults, and nothing
// overrides a stated value silently.
//
// Values carrying benchmark evidence keep their citation next to them: they
// are not free parameters, they were measured (COMFYUI-BENCHMARK-RECEIPT.md,
// TWO-PASS-COMPOSITOR-RECEIPT.md) and are pinned by
// tests/fixtures/benchmark-regression.json.

export const CONFIG = Object.freeze({
  server: Object.freeze({
    port: 3000,
    host: '127.0.0.1',
  }),

  // Which provider implementations exist and what each requires. The registry
  // reads this; it does not keep its own copy.
  providers: Object.freeze({
    envKeys: Object.freeze({
      chatProvider: 'CHAT_PROVIDER',
      imageProvider: 'IMAGE_PROVIDER',
      ollamaUrl: 'OLLAMA_URL',
      ollamaModel: 'OLLAMA_MODEL',
      hfToken: 'HF_TOKEN',
      hfImageModel: 'HF_IMAGE_MODEL',
      comfyUrl: 'COMFYUI_URL',
      comfyCheckpoint: 'COMFYUI_CHECKPOINT',
    }),
  }),

  // ComfyUI generation. feather 48 / overlap 0 / weight 0.8 / char-text 0 are
  // BENCHMARK-DERIVED (2026-08-18) - changing them requires a re-benchmark and
  // a receipt; the regression test fails otherwise.
  comfyui: Object.freeze({
    checkpoint: 'sd_xl_base_1.0.safetensors',
    steps: 30,
    cfg: 6.5,
    width: 1024,
    height: 1024,
    seed: null,                 // null = derive deterministically from sceneId
    maskFeather: 48,            // benchmark winner
    maskOverlap: 0,             // benchmark winner
    adapterWeight: 0.8,         // benchmark winner
    adapterWeightType: 'linear',
    backgroundConditioningStrength: 1.0,
    characterTextStrength: 0,   // benchmark: masked char-text drives merges
    ipadapterPreset: 'PLUS (high strength)',
    pipelineMode: 'single-pass',// 'two-pass' is opt-in pending its own benchmark
    refineDenoise: 0.6,
    refineSteps: 22,
    pollIntervalMs: 2000,
    timeoutMs: 240000,
  }),

  // Bounded retry. Only identity/composition failures earn a new seed;
  // infrastructure and input failures never do.
  retry: Object.freeze({
    maxAttempts: 3,
    retryableCategories: Object.freeze(['missing_character', 'unexpected_character', 'merge_swap', 'identity_below_threshold']),
  }),

  // Identity validation threshold.
  identity: Object.freeze({
    identityThreshold: 0.8,
  }),

  // Presentation review knobs. poseGuidance/compositionGuidance are null
  // because no such component is installed - null here means "does not
  // exist", not "use a default".
  presentation: Object.freeze({
    aestheticThreshold: 0.6,
    maskFeather: 48,
    maskOverlap: 0,
    adapterWeight: 0.8,
    backgroundConditioning: 1.0,
    poseGuidance: null,
    compositionGuidance: null,
  }),

  // Publication policy for the running server. requireHumanApproval is TRUE:
  // no real visual-quality model exists, so nothing publishes without a
  // named human approval.
  gallery: Object.freeze({
    requireHumanApproval: true,
    aestheticThreshold: 0.6,
  }),
});

export default CONFIG;
