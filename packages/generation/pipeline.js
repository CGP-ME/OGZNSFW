// Generation pipeline: the stable architecture layer above providers.
//
// Separation of powers (hardening pass, 2026-08-18):
//   - Providers GENERATE. They never retry, never validate, never publish.
//   - The pipeline owns attempts, retry policy, and provenance.
//   - Validators report. They never publish.
//   - The gallery gate (scene service) owns publication; it accepts nothing
//     unvalidated.
//
// The ComfyUI workflow is an adapter behind these interfaces. The current
// benchmark (2026-08-18) is preserved as a regression fixture in tests.
import { createHash } from 'node:crypto';
import { evaluateValidationReport } from '../providers/image/image-validator.js';

// ---------------------------------------------------------------------------
// CompositionPlan: where each cast member lives on the canvas. Pure data,
// derived from the structured request + tuning. The planner is deliberately
// simple (ordered vertical regions); a real layout pass replaces THIS
// function later without touching anything downstream.
export function planComposition(request, tuning = {}) {
  const n = request.characters.length;
  const width = tuning.width ?? 1024;
  const height = tuning.height ?? 1024;
  const feather = tuning.maskFeather ?? 48;
  const overlap = tuning.maskOverlap ?? 0;
  const slice = Math.floor(width / n);
  return {
    canvas: { width, height },
    camera: request.scene?.composition?.camera ?? null,
    lighting: request.scene?.composition?.lighting ?? null,
    regions: request.characters.map((c, i) => ({
      characterId: c.characterId,
      order: i,
      sceneRole: c.sceneRole,
      x: Math.max(0, i * slice - overlap),
      width: Math.min(width - Math.max(0, i * slice - overlap), slice + 2 * overlap),
      feather,
    })),
  };
}

// CharacterConditioningPlan: how each cast member's identity is conditioned -
// one plan per character, never blended. Text conditioning is off by default
// (benchmark: merge driver) and recorded explicitly so provenance shows what
// was and was not conditioned.
export function planConditioning(request, tuning = {}) {
  return request.characters.map((c) => ({
    characterId: c.characterId,
    characterVersion: c.characterVersion,
    referenceAssets: c.referenceAssets ?? [],
    identityLock: c.identityLock !== false,
    adapterWeight: tuning.adapterWeight ?? 0.8,
    adapterWeightType: tuning.adapterWeightType ?? 'linear',
    textConditioning: (tuning.characterTextStrength ?? 0) > 0
      ? { mode: 'experimental-masked-text', strength: tuning.characterTextStrength, wardrobe: c.wardrobe ?? null, poseAction: c.poseAction ?? null }
      : { mode: 'none', note: 'masked char-text disabled by benchmark evidence; wardrobe/pose carried by references and reserved for the multi-pass refinement stage' },
  }));
}

// ---------------------------------------------------------------------------
// RetryPolicy: which failures earn another seed, and how seeds are derived.
// Seeds are deterministic and reproducible: attempt N of a scene always gets
// the same seed.
export const defaultRetryPolicy = {
  maxAttempts: 3,
  // Only identity/composition validation failures are retryable - a new seed
  // can change composition. Infrastructure and input failures cannot be
  // fixed by a seed and must surface immediately.
  retryableCategories: ['missing_character', 'unexpected_character', 'merge_swap', 'identity_below_threshold'],
};

export function attemptSeed(sceneId, attempt) {
  // attempt 1 keeps the scene's canonical seed derivation; later attempts
  // derive from (sceneId, attempt) so the whole sequence is reproducible.
  const h = createHash('sha256').update(`${sceneId}::attempt-${attempt}`).digest();
  return h.readUInt32BE(0);
}

export function classifyValidationFailure(verdict) {
  const categories = [];
  for (const reason of verdict.reasons ?? []) {
    if (reason.includes('missing expected character')) categories.push('missing_character');
    else if (reason.includes('unexpected character')) categories.push('unexpected_character');
    else if (reason.includes('merge/swap')) categories.push('merge_swap');
    else if (reason.includes('below threshold')) categories.push('identity_below_threshold');
    else categories.push('other');
  }
  return categories;
}

export function isRetryable(categories, policy = defaultRetryPolicy) {
  return categories.length > 0 && categories.every((c) => policy.retryableCategories.includes(c));
}

// ---------------------------------------------------------------------------
// GenerationPipeline: generate -> technical check -> identity validation ->
// bounded deterministic retry -> provenance. Returns a decision; it never
// publishes (that stays behind the gallery gate).
export class GenerationPipeline {
  constructor({ provider, identityValidator = null, retryPolicy = defaultRetryPolicy }) {
    if (!provider) throw new Error('GenerationPipeline requires a provider');
    this.provider = provider;
    this.identityValidator = identityValidator;
    this.policy = retryPolicy;
  }

  async run(request) {
    if (request?.kind !== 'multi-character-image-request' || !request.characters?.length) {
      // Malformed input: non-retryable by definition, no attempts consumed.
      return { ok: false, reason: 'malformed scene request', attempts: [], provenance: null };
    }
    const composition = planComposition(request, this.provider.tuning ?? {});
    const conditioning = planConditioning(request, this.provider.tuning ?? {});
    const attempts = [];
    const startedAll = Date.now();
    let selected = null;

    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt++) {
      const seed = attemptSeed(request.sceneId, attempt);
      const record = { attempt, seed, startedAt: new Date().toISOString(), workflowHash: null, output: null, error: null, validation: null, ms: null };
      attempts.push(record);
      const t0 = Date.now();

      let output;
      try {
        output = await this.provider.generateFromScene(request, { seed });
      } catch (err) {
        // Provider/infrastructure failures are never retryable: record and stop.
        record.error = { message: err.message, retryable: false };
        record.ms = Date.now() - t0;
        return { ok: false, reason: `generation failed (non-retryable): ${err.message}`, attempts, composition, conditioning, provenance: this.provenance(request, attempts, null, startedAll) };
      }
      record.ms = Date.now() - t0;
      record.workflowHash = output.provenance?.workflowHash ?? null;
      record.output = { uri: output.uri, provider: output.provider, model: output.model, provenance: output.provenance ?? null };

      if (!this.identityValidator) {
        // No validator configured: honest single attempt, pending human
        // review. Retrying blind would be guessing.
        record.validation = { status: 'not validated', note: 'no identity validator configured; needs human review' };
        selected = record;
        return { ok: true, pendingValidation: true, selected, attempts, composition, conditioning, provenance: this.provenance(request, attempts, selected, startedAll) };
      }

      const report = await this.identityValidator.validate({ request, asset: record.output });
      const verdict = evaluateValidationReport(report);
      const categories = verdict.pass ? [] : classifyValidationFailure(verdict);
      record.validation = { report, verdict, categories };

      if (verdict.pass) {
        selected = record;
        return { ok: true, selected, attempts, composition, conditioning, provenance: this.provenance(request, attempts, selected, startedAll) };
      }
      if (!isRetryable(categories, this.policy)) {
        return { ok: false, reason: `validation failed (non-retryable): ${verdict.reasons.join('; ')}`, attempts, composition, conditioning, provenance: this.provenance(request, attempts, null, startedAll) };
      }
      // retryable: loop continues with the next deterministic seed
    }
    return { ok: false, reason: `all ${this.policy.maxAttempts} attempts failed identity validation`, attempts, composition, conditioning, provenance: this.provenance(request, attempts, null, startedAll) };
  }

  // GenerationProvenance: the full evidence trail for a run.
  provenance(request, attempts, selected, startedAll) {
    return {
      sceneId: request.sceneId,
      tenantId: request.tenantId,
      provider: this.provider.name,
      expectedCharacterIds: request.provenance?.expectedCharacterIds ?? request.characters.map((c) => c.characterId),
      characterVersions: Object.fromEntries(request.characters.map((c) => [c.characterId, c.characterVersion])),
      attempts: attempts.map((a) => ({ attempt: a.attempt, seed: a.seed, workflowHash: a.workflowHash, ms: a.ms, error: a.error?.message ?? null, verdict: a.validation?.verdict?.pass === true ? 'passed' : (a.validation?.verdict ? 'failed' : (a.validation?.status ?? 'no validation')), categories: a.validation?.categories ?? [] })),
      selectedAttempt: selected?.attempt ?? null,
      totalMs: Date.now() - startedAll,
      policy: { maxAttempts: this.policy.maxAttempts, retryableCategories: this.policy.retryableCategories },
    };
  }
}
