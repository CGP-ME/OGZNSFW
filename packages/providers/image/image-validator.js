// Image validation interface + verdict logic for multi-character output.
//
// HONEST STATUS: no real computer-vision validation exists yet. This module
// defines the interface, the report shape, and the deterministic verdict
// rules. Real detection (face embedding match against reference packs) is a
// later milestone; tests use clearly-labeled deterministic doubles under
// tests/fixtures/. Nothing here claims CV capability it does not have.

// Report shape produced by any validator implementation:
// {
//   expectedCharacters:  [{ characterId, characterVersion }],
//   detectedCharacters:  [{ characterId, identityScore (0..1), region }],
//   missingCharacters:   [characterId],
//   unexpectedCharacters:[characterId or descriptor],
//   identityScores:      { [characterId]: number },
//   mergeSwapWarnings:   [string],
//   wardrobeRoleWarnings:[string],
// }

export class ImageValidator {
  // Implementations receive the structured request plus the provider output
  // and return a report in the shape above.
  // eslint-disable-next-line no-unused-vars
  async validate({ request, asset }) {
    throw new Error('validate() must be implemented - no real image validation exists yet');
  }
}

// Build the derived fields of a report from expectations + raw detections so
// implementations (and test doubles) only supply detections.
export function deriveValidationReport(expectedCharacters, detectedCharacters, { mergeSwapWarnings = [], wardrobeRoleWarnings = [] } = {}) {
  const expectedIds = expectedCharacters.map((c) => c.characterId);
  const detectedIds = detectedCharacters.map((d) => d.characterId).filter(Boolean);
  return {
    expectedCharacters,
    detectedCharacters,
    missingCharacters: expectedIds.filter((id) => !detectedIds.includes(id)),
    unexpectedCharacters: detectedIds.filter((id) => !expectedIds.includes(id)),
    identityScores: Object.fromEntries(detectedCharacters.filter((d) => d.characterId).map((d) => [d.characterId, d.identityScore])),
    mergeSwapWarnings,
    wardrobeRoleWarnings,
  };
}

// Deterministic verdict rules. Hard failures: missing characters, unexpected
// characters, merge/swap warnings, or identity scores below threshold.
// Wardrobe/role issues are warnings: reported, not fatal.
export function evaluateValidationReport(report, { identityThreshold = 0.8 } = {}) {
  const reasons = [];
  if (report.missingCharacters?.length) {
    reasons.push(`missing expected character(s): ${report.missingCharacters.join(', ')}`);
  }
  if (report.unexpectedCharacters?.length) {
    reasons.push(`unexpected character(s) in output: ${report.unexpectedCharacters.join(', ')}`);
  }
  if (report.mergeSwapWarnings?.length) {
    reasons.push(`identity merge/swap detected: ${report.mergeSwapWarnings.join('; ')}`);
  }
  for (const [id, score] of Object.entries(report.identityScores ?? {})) {
    if (typeof score === 'number' && score < identityThreshold) {
      reasons.push(`identity score for ${id} (${score}) below threshold (${identityThreshold})`);
    }
  }
  return {
    pass: reasons.length === 0,
    reasons,
    warnings: [...(report.wardrobeRoleWarnings ?? [])],
  };
}
