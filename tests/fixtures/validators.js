// TEST FIXTURES ONLY. Deterministic image-validator doubles for exercising
// the validation interface and verdict rules. These are scripted doubles, not
// computer vision - real detection does not exist yet and nothing here
// pretends otherwise. Never imported by runtime code (enforced by the
// no-fixtures-in-runtime guard tests).
import { ImageValidator, deriveValidationReport } from '../../packages/providers/image/image-validator.js';

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
