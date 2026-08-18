// TEST FIXTURES ONLY. Deterministic image-validator doubles for exercising
// the validation interface and verdict rules. These are scripted doubles, not
// computer vision - real detection does not exist yet and nothing here
// pretends otherwise. Never imported by runtime code (enforced by the
// no-fixtures-in-runtime guard tests).
import { ImageValidator, deriveValidationReport } from '../../packages/providers/image/image-validator.js';

// Deterministic presentation-quality double: returns the report it was
// scripted with. TEST FIXTURE ONLY - no real visual-quality model exists.
import { PresentationQualityAssessor, presentationReportTemplate } from '../../packages/providers/image/presentation-quality.js';

export class ScriptedPresentationAssessor extends PresentationQualityAssessor {
  constructor(overrides = {}) {
    super();
    this.overrides = overrides;
  }
  async assess() {
    return { ...presentationReportTemplate(), humanReviewRequired: false, ...this.overrides };
  }
}

// Sequenced validator double: returns one scripted report per validate()
// call, in order - for exercising retry paths deterministically. TEST
// FIXTURE ONLY.
export class SequencedImageValidator extends ImageValidator {
  constructor(detectionSequences) {
    super();
    this.sequences = detectionSequences;
    this.calls = 0;
  }
  async validate({ request }) {
    const expected = request.characters.map((c) => ({ characterId: c.characterId, characterVersion: c.characterVersion }));
    const step = this.sequences[Math.min(this.calls, this.sequences.length - 1)];
    this.calls++;
    return deriveValidationReport(expected, step.detections ?? [], { mergeSwapWarnings: step.mergeSwapWarnings ?? [], wardrobeRoleWarnings: [] });
  }
}

// Returns exactly the detections it was scripted with.
export class ScriptedImageValidator extends ImageValidator {
  constructor({ detections = [], mergeSwapWarnings = [], wardrobeRoleWarnings = [] } = {}) {
    super();
    this.detections = detections;
    this.mergeSwapWarnings = mergeSwapWarnings;
    this.wardrobeRoleWarnings = wardrobeRoleWarnings;
  }

  async validate({ request }) {
    const expected = request.characters.map((c) => ({ characterId: c.characterId, characterVersion: c.characterVersion }));
    return deriveValidationReport(expected, this.detections, {
      mergeSwapWarnings: this.mergeSwapWarnings,
      wardrobeRoleWarnings: this.wardrobeRoleWarnings,
    });
  }
}
