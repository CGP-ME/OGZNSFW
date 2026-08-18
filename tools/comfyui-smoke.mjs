// INTEGRATION SMOKE - talks to a REAL local ComfyUI server. Not a unit test;
// never run in CI. SFW content only. Output is saved locally and is NOT
// published to any gallery.
//
// Usage:
//   node tools/comfyui-smoke.mjs            # replay the preserved Phase 1 two-character workflow verbatim
//   node tools/comfyui-smoke.mjs --provider # exercise ComfyUIImageProvider.generateFromScene end to end
//
// Requires COMFYUI_URL (default http://127.0.0.1:8188) and, for both modes,
// refA.png / refB.png present in ComfyUI's input directory (staged in Phase 1).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComfyUIImageProvider, ComfyHttpClient } from '../packages/providers/image/comfyui.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const outDir = path.join(ROOT, 'tools', 'smoke-output');

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function saveResult(uri, name) {
  await mkdir(outDir, { recursive: true });
  const b64 = uri.split(',')[1];
  const file = path.join(outDir, name);
  await writeFile(file, Buffer.from(b64, 'base64'));
  log(`output saved (UNPUBLISHED): ${file}`);
}

const providerMode = process.argv.includes('--provider');
const client = new ComfyHttpClient(baseUrl);

try {
  const stats = await client.getJson('/system_stats');
  log(`ComfyUI reachable: version ${stats.system?.comfyui_version}`);
} catch (err) {
  log(`REFUSED: ComfyUI unreachable at ${baseUrl}: ${err.message}`);
  process.exit(1);
}

if (providerMode) {
  // Exercise the real adapter path with a neutral SFW scene request.
  const provider = new ComfyUIImageProvider(baseUrl);
  const request = {
    kind: 'multi-character-image-request',
    sceneId: 'smoke-provider-scene',
    tenantId: 'smoke',
    scene: { setting: { location: 'sunlit park, afternoon' }, composition: { camera: 'medium two-shot, eye level', lighting: 'natural light' }, relationships: [] },
    characters: [
      { characterId: 'refA', characterVersion: 1, sceneRole: 'left foreground', referenceAssets: ['asset://refA'], wardrobe: 'dark jacket', poseAction: 'standing relaxed', identityLock: true, identity: {} },
      { characterId: 'refB', characterVersion: 1, sceneRole: 'right foreground', referenceAssets: ['asset://refB'], wardrobe: 'olive blouse', poseAction: 'standing relaxed', identityLock: true, identity: {} },
    ],
    provenance: { expectedCharacterIds: ['refA', 'refB'] },
  };
  log('submitting generateFromScene (neutral two-character request)...');
  const result = await provider.generateFromScene(request);
  log(`SUCCESS: provider=${result.provider} checkpoint=${result.provenance.checkpoint} seed=${result.provenance.seed}`);
  log(`workflowHash=${result.provenance.workflowHash}`);
  await saveResult(result.uri, `provider-smoke-${Date.now()}.png`);
} else {
  // Replay the preserved Phase 1 workflow VERBATIM (unaltered).
  const preserved = JSON.parse(await readFile(path.join(ROOT, 'tools', 'workflows', 'two-character-phase1.json'), 'utf8'));
  log('replaying preserved Phase 1 two-character workflow (unaltered)...');
  const queued = await client.postJson('/prompt', preserved);
  if (!queued.prompt_id) { log('REFUSED: no prompt_id returned'); process.exit(1); }
  log(`queued: ${queued.prompt_id}`);
  const deadline = Date.now() + 180000;
  let entry = null;
  while (Date.now() < deadline) {
    const h = await client.getJson(`/history/${queued.prompt_id}`);
    entry = h?.[queued.prompt_id];
    if (entry?.status?.completed || entry?.status?.status_str === 'error') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!entry?.status?.completed) { log(`FAILED: status=${entry?.status?.status_str ?? 'timeout'}`); process.exit(1); }
  const img = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? [])[0];
  if (!img) { log('FAILED: no output image'); process.exit(1); }
  const bytes = await client.getBytes(`/view?filename=${encodeURIComponent(img.filename)}&type=output&subfolder=`);
  log(`SUCCESS: retrieved ${img.filename} (${bytes.length} bytes)`);
  await saveResult(`data:image/png;base64,${bytes.toString('base64')}`, `phase1-replay-${Date.now()}.png`);
}
