// Capability contracts - the single source of truth for what an
// implementation must actually provide before it is allowed into runtime.
//
// DOCTRINE (fourth shape): the abstract stubs in the base classes throw when
// an unimplemented method is called. Rather than letting that happen deep in
// a generation run, selection validates the implementation FIRST and refuses
// loudly at the beginning, naming the exact missing capability. The stubs
// stay as defensive tripwires - they simply become unreachable for anything
// that passes selection.
//
// This duplicates no provider truth: the registry still owns which providers
// exist and what env they need; this owns only "does this object implement
// its interface".
import { ChatProvider } from './chat/index.js';
import { ImageProvider } from './image/index.js';
import { ImageValidator } from './image/image-validator.js';
import { PresentationQualityAssessor } from './image/presentation-quality.js';

const CONTRACTS = {
  chatProvider: { base: ChatProvider, required: ['name', 'chat', 'probe'] },
  imageProvider: { base: ImageProvider, required: ['name', 'generate', 'probe'] },
  imageValidator: { base: ImageValidator, required: ['validate'] },
  presentationAssessor: { base: PresentationQualityAssessor, required: ['assess'] },
};

export function requiredCapabilities(kind) {
  return CONTRACTS[kind] ? [...CONTRACTS[kind].required] : null;
}

// Returns { ok, missing: [names], detail }. Never throws: a validator that
// throws would be the same defect it exists to catch.
export function validateCapabilities(kind, instance) {
  const contract = CONTRACTS[kind];
  if (!contract) {
    return { ok: false, missing: [], detail: `no capability contract defined for component kind "${kind}"` };
  }
  if (!instance || (typeof instance !== 'object' && typeof instance !== 'function')) {
    return { ok: false, missing: [...contract.required], detail: `${kind} implementation is not an object` };
  }
  const missing = [];
  for (const cap of contract.required) {
    const baseDescriptor = Object.getOwnPropertyDescriptor(contract.base.prototype, cap);
    const isAccessor = !!(baseDescriptor && typeof baseDescriptor.get === 'function');
    if (isAccessor) {
      // Reading an unimplemented accessor hits the defensive stub, which
      // throws. That throw is CAUGHT HERE and converted into a named
      // refusal - the stub fires during validation, never during work.
      let value;
      try {
        value = instance[cap];
      } catch {
        missing.push(cap);
        continue;
      }
      if (typeof value !== 'string' || value.trim() === '') missing.push(cap);
      continue;
    }
    const fn = instance[cap];
    // Inherited-but-not-overridden means the abstract stub: not implemented.
    if (typeof fn !== 'function' || fn === contract.base.prototype[cap]) missing.push(cap);
  }
  if (missing.length) {
    const label = (() => { try { return instance?.constructor?.name ?? String(kind); } catch { return String(kind); } })();
    return { ok: false, missing, detail: `${kind} "${label}" is missing required capability/capabilities: ${missing.join(', ')}` };
  }
  return { ok: true, missing: [], detail: null };
}
