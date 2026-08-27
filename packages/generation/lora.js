// Character LoRA references: the data structures generation provenance uses
// to make every image traceable to a specific trained identity artifact.
// Architecture-neutral: providers receive resolved refs; nothing ComfyUI-
// specific lives here. Full record shape: training/schemas/lora-provenance.schema.json

// A resolved reference attached to a character in a generation request.
export function characterLoraRef({ loraId, characterId, characterVersion, revision, fileHash, triggerToken, baseModelHash }) {
  for (const [k, v] of Object.entries({ loraId, characterId, characterVersion, revision, fileHash, triggerToken, baseModelHash })) {
    if (v === undefined || v === null) throw new Error(`characterLoraRef: ${k} is required`);
  }
  return Object.freeze({ loraId, characterId, characterVersion, revision, fileHash, triggerToken, baseModelHash });
}

// Validate a full provenance record against the required fields (structural,
// mirrors the JSON schema's required set; schema remains the authority).
export function validateLoraProvenance(record) {
  const errors = [];
  for (const field of ['loraId', 'characterId', 'characterVersion', 'revision', 'fileHash', 'baseModel', 'datasetManifestHash', 'training', 'validation']) {
    if (record?.[field] === undefined || record?.[field] === null) errors.push(`missing ${field}`);
  }
  for (const field of ['tool', 'rank', 'learningRate', 'steps', 'resolution', 'seed']) {
    if (record?.training?.[field] === undefined) errors.push(`missing training.${field}`);
  }
  if (record?.validation && !['not-run', 'in-review', 'passed', 'failed'].includes(record.validation.status)) {
    errors.push('validation.status invalid');
  }
  return { valid: errors.length === 0, errors };
}

// Production gate: a LoRA may be used for published generations only after
// full-evaluation-set validation passed. One good image is never enough.
export function loraUsableForPublication(provenanceRecord) {
  return provenanceRecord?.validation?.status === 'passed';
}
