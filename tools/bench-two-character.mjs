// Two-character tuning benchmark - INTEGRATION tool (real local ComfyUI).
// SFW scenes only. Outputs land in tools/smoke-output/ (gitignored),
// UNPUBLISHED. Deterministic: every run is seed+config addressed.
//
// Usage: node tools/bench-two-character.mjs [sceneKey]
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComfyUIImageProvider } from '../packages/providers/image/comfyui.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools', 'smoke-output');
const baseUrl = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';

const SCENES = {
  park: {
    setting: { location: 'sunlit park, afternoon' },
    composition: { camera: 'medium two-shot, eye level', lighting: 'natural light' },
  },
  editorial: {
    setting: { location: 'art gallery opening, evening editorial' },
    composition: { camera: 'medium two-shot, eye level', lighting: 'warm gallery lighting' },
  },
};

const VARIANTS = {
  A: { maskFeather: 0, maskOverlap: 0, adapterWeight: 0.8 },   // proven baseline
  B: { maskFeather: 48, maskOverlap: 0, adapterWeight: 0.8 },  // seam remedy alone
  C: { maskFeather: 48, maskOverlap: 16, adapterWeight: 0.65 },// identity relaxed
  D: { maskFeather: 96, maskOverlap: 32, adapterWeight: 0.8 }, // aggressive blend
};

const SEEDS = [20260818, 777];
const sceneKey = process.argv[2] || 'park';
const variantKeys = (process.argv[3] || 'A,B,C,D').split(',');

function request(scene) {
  return {
    kind: 'multi-character-image-request',
    sceneId: `bench-${sceneKey}`,
    tenantId: 'bench',
    scene: { ...SCENES[scene], relationships: [] },
    characters: [
      { characterId: 'refA', characterVersion: 1, sceneRole: 'left foreground', referenceAssets: ['asset://refA'], wardrobe: 'dark jacket', identityLock: true, identity: { gender: 'female' } },
      { characterId: 'refB', characterVersion: 1, sceneRole: 'right foreground', referenceAssets: ['asset://refB'], wardrobe: 'olive blouse', identityLock: true, identity: { gender: 'female' } },
    ],
    provenance: { expectedCharacterIds: ['refA', 'refB'] },
  };
}

await mkdir(OUT, { recursive: true });
const results = [];
for (const v of variantKeys) {
  for (const seed of SEEDS) {
    const provider = new ComfyUIImageProvider(baseUrl, { tuning: { ...VARIANTS[v], seed } });
    const started = Date.now();
    try {
      const r = await provider.generateFromScene(request(sceneKey));
      const name = `bench-${sceneKey}-${v}-${seed}.png`;
      await writeFile(path.join(OUT, name), Buffer.from(r.uri.split(',')[1], 'base64'));
      results.push({ variant: v, seed, file: name, hash: r.provenance.workflowHash.slice(0, 12), ms: Date.now() - started });
      console.log(`OK ${sceneKey}/${v}/${seed} ${Date.now() - started}ms -> ${name}`);
    } catch (err) {
      results.push({ variant: v, seed, error: err.message });
      console.log(`FAIL ${sceneKey}/${v}/${seed}: ${err.message}`);
    }
  }
}
await writeFile(path.join(OUT, `bench-${sceneKey}-manifest.json`), JSON.stringify({ sceneKey, variants: VARIANTS, seeds: SEEDS, results, at: new Date().toISOString() }, null, 2));
console.log('manifest written');
