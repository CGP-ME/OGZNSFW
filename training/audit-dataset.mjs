// Dataset audit: a manifest is NOT training-ready until this passes.
// Usage: node training/audit-dataset.mjs <manifest.json>
// Also importable: auditManifest(manifest) -> { ready, errors, stats }
import { readFile } from 'node:fs/promises';

export function auditManifest(manifest) {
  const errors = [];
  const req = (cond, msg) => { if (!cond) errors.push(msg); };

  req(manifest?.tenantId, 'tenantId required');
  req(manifest?.characterId, 'characterId required');
  req(Number.isInteger(manifest?.characterVersion), 'integer characterVersion required');
  req(manifest?.specHash, 'specHash required (dataset must bind to an approved character spec)');
  req(manifest?.triggerToken, 'triggerToken required');
  req(manifest?.captionPolicy === 'trigger-plus-variables', 'captionPolicy must be trigger-plus-variables');

  const images = manifest?.images ?? [];
  const training = images.filter((i) => i.split === 'training');
  const evaluation = images.filter((i) => i.split === 'evaluation');
  req(images.length > 0, 'no images in manifest');

  const seen = new Map();
  for (const img of images) {
    const label = img.path ?? '(no path)';
    req(/^[a-f0-9]{64}$/.test(img.sha256 ?? ''), `${label}: sha256 required`);
    if (seen.has(img.sha256)) errors.push(`duplicate image hash: ${label} == ${seen.get(img.sha256)}`);
    seen.set(img.sha256, label);
    req(img.approval?.status === 'approved' || img.approval?.status === 'rejected', `${label}: approval must be resolved (approved/rejected), found "${img.approval?.status}"`);
    if (img.approval?.status === 'approved') {
      req(img.approval.approvedBy, `${label}: approved images need approvedBy`);
      req(img.source?.licensing !== 'unclear', `${label}: unclear licensing cannot be approved`);
      req(img.caption?.includes(manifest.triggerToken), `${label}: caption must contain the trigger token`);
    }
    if (img.approval?.status === 'rejected') {
      req(img.approval.rejectedReason, `${label}: rejected images need rejectedReason`);
    }
  }

  const approvedTraining = training.filter((i) => i.approval?.status === 'approved');
  const approvedEval = evaluation.filter((i) => i.approval?.status === 'approved');
  req(approvedTraining.length >= 16, `at least 16 approved training images required (found ${approvedTraining.length})`);
  req(approvedEval.length >= 6, `at least 6 approved evaluation images required (found ${approvedEval.length})`);
  // splits share no hashes
  const trainHashes = new Set(approvedTraining.map((i) => i.sha256));
  for (const e of approvedEval) req(!trainHashes.has(e.sha256), `evaluation image ${e.path} also appears in training split`);

  return {
    ready: errors.length === 0,
    errors,
    stats: { total: images.length, approvedTraining: approvedTraining.length, approvedEval: approvedEval.length, rejected: images.filter((i) => i.approval?.status === 'rejected').length },
  };
}

const isMain = process.argv[1] && process.argv[1].endsWith('audit-dataset.mjs');
if (isMain) {
  const manifestPath = process.argv[2];
  if (!manifestPath) { console.log('usage: node training/audit-dataset.mjs <manifest.json>'); process.exit(2); }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const result = auditManifest(manifest);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ready ? 0 : 1);
}
