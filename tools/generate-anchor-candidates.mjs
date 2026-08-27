// Anchor-candidate generator - INTEGRATION tool (real local ComfyUI). SFW.
// Generates fresh candidate images from an APPROVED character spec (text
// only - deliberately no reference conditioning: the candidate review is
// where Trey picks the canonical face). Nothing is auto-approved; every
// candidate is recorded with seed, workflow hash, prompt, and spec hash in a
// pending-approval manifest for Trey's review.
//
// Age presentation is a SEPARATE gate from numeric age: the spec's
// agePresentation block drives both positive cues and appended negatives.
// The pipeline's mandatory child/teenager negatives always remain in force.
//
// Usage: node tools/generate-anchor-candidates.mjs <characterId> [count] [round]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComfyUIImageProvider } from '../packages/providers/image/comfyui.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const characterId = process.argv[2];
if (!characterId) { console.log('usage: node tools/generate-anchor-candidates.mjs <characterId> [count] [round]'); process.exit(2); }
const count = Number(process.argv[3] ?? 24);
const round = Number(process.argv[4] ?? 1);

const specRaw = await readFile(path.join(ROOT, 'training', 'characters', `${characterId}.spec.json`), 'utf8');
const spec = JSON.parse(specRaw);
if (spec.specStatus !== 'approved-by-Trey') { console.log(`REFUSED: spec status is "${spec.specStatus}" - candidates only generate against approved specs`); process.exit(1); }
const specHash = createHash('sha256').update(specRaw).digest('hex');

const inv = spec.invariantIdentity;
const age = spec.agePresentation ?? {};
// Age presentation LEADS the subject phrase (word order is load-bearing for
// SDXL), then invariant identity traits, then the scene-dependent variables.
const subject = age.target ? `${age.target}` : `adult woman, age ${spec.consent.age}`;
const identityText = [subject, ...(age.positiveCues ?? []), inv.face, `${inv.hair} hair`, `${inv.eyes} eyes`, inv.complexion, inv.build, ...(inv.identifyingMarks ?? [])].join(', ');
const extraNegative = (age.forbiddenAgingCues ?? []).join(', ');

const ANGLES = ['frontal portrait, looking at camera', 'three-quarter view from her left', 'three-quarter view from her right', 'profile view'];
const LIGHTING = ['soft studio lighting', 'golden hour window light', 'overcast daylight'];
const WARDROBE = { nova: ['black techwear jacket', 'charcoal fitted turtleneck', 'dark utility vest over black tee'], iris: ['olive silk blouse', 'cream knit sweater', 'rust-toned wrap dress'] }[characterId] ?? ['casual top', 'jacket', 'sweater'];
const BACKGROUNDS = ['neutral studio backdrop', 'blurred city street', 'soft interior, warm tones', 'leafy outdoor background'];
const FRAMING = ['head and shoulders portrait', 'waist-up shot', 'head and shoulders portrait', 'full body shot'];

const outDir = `Q:/AI/training/${characterId}/v1/candidates-r${round}`;
await mkdir(outDir, { recursive: true });
const seedBase = 500000 + (round - 1) * 100000; // fresh deterministic seeds per round

const candidates = [];
for (let i = 0; i < count; i++) {
  const angle = ANGLES[i % ANGLES.length];
  const light = LIGHTING[Math.floor(i / ANGLES.length) % LIGHTING.length];
  const wardrobe = WARDROBE[i % WARDROBE.length];
  const background = BACKGROUNDS[i % BACKGROUNDS.length];
  const framing = FRAMING[i % FRAMING.length];
  const seed = seedBase + i;
  const prompt = `professional editorial photograph, ${framing}, ${angle}, of one ${identityText}, wearing ${wardrobe}, ${background}, ${light}, sharp focus, photorealistic, solo, exactly one person`;
  const provider = new ComfyUIImageProvider(baseUrl, { tuning: { seed } });
  const t0 = Date.now();
  try {
    const r = await provider.generate({ prompt, characterRecord: null, extraNegative });
    const file = `${outDir}/${characterId}-r${round}c${String(i + 1).padStart(2, '0')}-s${seed}.png`;
    const bytes = Buffer.from(r.uri.split(',')[1], 'base64');
    await writeFile(file, bytes);
    candidates.push({
      candidateId: `${characterId}-r${round}c${String(i + 1).padStart(2, '0')}`,
      round, seed,
      workflowHash: r.provenance.workflowHash,
      prompt,
      negativePromptExtra: extraNegative,
      variation: { angle, light, wardrobe, background, framing },
      outputPath: file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      approval: { status: 'pending', approvedBy: null, at: null, rejectedReason: null },
    });
    console.log(`OK ${characterId} r${round}c${i + 1}/${count} seed=${seed} ${Date.now() - t0}ms`);
  } catch (err) {
    candidates.push({ candidateId: `${characterId}-r${round}c${String(i + 1).padStart(2, '0')}`, round, seed, error: err.message, approval: { status: 'pending' } });
    console.log(`FAIL r${round}c${i + 1}: ${err.message}`);
  }
}

const manifest = {
  characterId,
  characterVersion: spec.characterVersion,
  round,
  specHash,
  specStatus: spec.specStatus,
  triggerToken: spec.triggerToken,
  agePresentationTarget: age.target ?? null,
  generatedAt: new Date().toISOString(),
  note: 'CANDIDATES ONLY - nothing here is approved; Trey reviews and marks approved/rejected before any manifest entry becomes training data',
  candidates,
};
const manifestPath = path.join(ROOT, 'training', 'datasets', `${characterId}-v1-candidates-r${round}.json`);
await mkdir(path.dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`manifest: ${manifestPath} (${candidates.filter((c) => !c.error).length}/${count} generated)`);
