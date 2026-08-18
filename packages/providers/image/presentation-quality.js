// Presentation-quality checkpoint: the second gate after identity validation.
// Identity success alone is not sufficient - an image can preserve both
// characters and still be commercially unusable (seams, leaked backgrounds,
// stiff poses, bad framing). This layer assesses presentation SEPARATELY from
// identity and technical validity, and it never pretends to be an objective
// attractiveness oracle: the score field is visualAppealScore, and when no
// real visual-quality model is configured the honest answer is
// "human review required".
//
// Four distinguished axes, never conflated:
//   1. identity validity   (existing image-validator verdict)
//   2. technical validity  (generation completed, output retrieved)
//   3. visual appeal       (this layer)
//   4. human approval      (explicit, recorded)

// Assessor interface. No runtime implementation exists yet; deterministic
// test doubles live under tests/fixtures/.
export class PresentationQualityAssessor {
  // eslint-disable-next-line no-unused-vars
  async assess({ request, asset, identityReport }) {
    throw new Error('assess() must be implemented - no real visual-quality model is configured');
  }
}

// Canonical report shape (all scores 0..1; levels: 'none'|'low'|'high').
export function presentationReportTemplate() {
  return {
    compositionScore: null,
    characterPresenceScore: null,
    identitySeparationScore: null,
    facialQualityScore: null,
    visualAppealScore: null,
    anatomyArtifactWarnings: [],
    wardrobeCoherence: null,
    poseNaturalness: null,
    expressionQuality: null,
    lightingBackgroundCoherence: null,
    seamVisibility: 'none',
    backgroundLeakage: 'none',
    cropFramingQuality: null,
    commercialReadiness: null,      // 'ready' | 'weak' | 'unknown'
    humanReviewRequired: true,      // honest default
  };
}

// Future-tuning configuration: the knobs the benchmark lane will sweep.
export const presentationTuningConfig = {
  maskFeather: 40,
  maskOverlap: 32,
  adapterWeight: 0.8,
  backgroundConditioning: 1.0,
  poseGuidance: null,          // not implemented (no pose-control component installed)
  compositionGuidance: null,   // not implemented (layout pass is a future milestone)
  aestheticThreshold: 0.6,
};

// Evaluate a presentation report into a presentation verdict:
// 'presentation_ready' | 'visually_weak' | 'needs_human_review'
export function evaluatePresentationReport(report, { aestheticThreshold = presentationTuningConfig.aestheticThreshold } = {}) {
  const warnings = [];
  if (!report) return { verdict: 'needs_human_review', warnings: ['no presentation report'], reasons: ['no visual-quality assessment available'] };
  if (report.humanReviewRequired) {
    return { verdict: 'needs_human_review', warnings, reasons: ['assessor flagged human review required'] };
  }
  const reasons = [];
  const low = (name, v) => { if (typeof v === 'number' && v < aestheticThreshold) reasons.push(`${name} ${v} below threshold ${aestheticThreshold}`); };
  low('visualAppealScore', report.visualAppealScore);
  low('compositionScore', report.compositionScore);
  low('poseNaturalness', report.poseNaturalness);
  low('cropFramingQuality', report.cropFramingQuality);
  if (report.seamVisibility === 'high') { reasons.push('visible seam between character regions'); warnings.push('seam visibility high'); }
  else if (report.seamVisibility === 'low') warnings.push('minor seam visibility');
  if (report.backgroundLeakage === 'high') { reasons.push('reference background leaked into scene'); warnings.push('background leakage high'); }
  else if (report.backgroundLeakage === 'low') warnings.push('minor background leakage');
  if (report.anatomyArtifactWarnings?.length) {
    reasons.push('anatomy/artifact warnings present');
    warnings.push(...report.anatomyArtifactWarnings);
  }
  if (typeof report.poseNaturalness === 'number' && report.poseNaturalness < aestheticThreshold) warnings.push('awkward pose');
  return { verdict: reasons.length ? 'visually_weak' : 'presentation_ready', warnings, reasons };
}

// Combine all four axes into the final gallery verdict:
// 'rejected_identity' | 'rejected_technical' | 'needs_human_review' |
// 'visually_weak' | 'presentation_ready' | 'approved_for_gallery'
export function computeFinalVerdict({ identityStatus, technicalOk, presentation, humanApproval, requireHumanApproval }) {
  if (identityStatus === 'failed') return 'rejected_identity';
  if (identityStatus !== 'passed') return 'needs_human_review'; // pending identity = not publishable
  if (!technicalOk) return 'rejected_technical';

  const approved = humanApproval?.approved === true;

  // No presentation report at all: presentation is "not assessed", which is
  // not a rejection. Human approval gates it only where configured.
  if (!presentation) {
    if (requireHumanApproval && !approved) return 'needs_human_review';
    return 'approved_for_gallery';
  }

  const p = presentation.verdict;
  if (p === 'visually_weak') return approved ? 'approved_for_gallery' : 'visually_weak';
  if (p === 'needs_human_review') return approved ? 'approved_for_gallery' : 'needs_human_review';
  // presentation_ready
  if (requireHumanApproval && !approved) return 'needs_human_review';
  return 'approved_for_gallery';
}
