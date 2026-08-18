# Receipt: M-20260818-001 (ComfyUI Backend Inspection and Setup Design)

- Mission ID: M-20260818-001
- Date/time: 2026-08-18 (machine local, UTC-7)
- Requester: Trey
- Assigned agent: Fable (Claude Code session, model claude-fable-5)
- Objective: Inspect the machine for ComfyUI/image-generation state, determine
  gaps, and design the first two-character test workflow. Report before any
  install; nothing installed in this mission.
- Forbidden actions honored: scene API untouched, no customer data, no adult
  prompts, no VPS, no commit/push, no weights or nodes installed.

## Findings (all verified on this machine)

1. **ComfyUI installed: NO.** Searched Q:\ root, Q:\ogz-training (empty),
   C:\, user profile, Downloads, Documents, AppData\Local\Programs, plus
   comfy/comfy-cli on PATH and the desktop-app location. No ComfyUI, no
   A1111/Forge, no SD-ecosystem install of any kind exists.
2. **Models/custom nodes: none.** There is no models directory anywhere; no
   checkpoints, LoRAs, IPAdapter, InstantID, or ControlNet weights on disk.
3. **GPU: NVIDIA RTX 4090, 24564 MiB VRAM, driver 596.21** (current). Ample
   for SDXL + per-character identity adapters; ~2.7 GiB currently in use.
   Note: Ollama (qwen3:14b, ~15 GiB when warm) shares this GPU - chat and
   image generation will contend for VRAM when both are hot.
4. **ComfyUI API: not running** (nothing on 127.0.0.1:8188; expected, since
   nothing is installed). Once installed, ComfyUI serves a JSON graph API at
   /prompt plus /system_stats, /history, /view - a clean fit for an
   ImageProvider adapter implementing generateFromScene().
5. **Workflow format for reference images:** ComfyUI "API format" JSON (node
   graph keyed by node id). Reference images enter via LoadImage nodes feeding
   identity adapters (IPAdapter FaceID / InstantID / PuLID). This maps
   directly onto our reference packs: one LoadImage chain per reference asset.
6. **Multi-character conditioning: representable per character.** The
   standard mechanism is per-character identity adapters with regional
   attention masks (IPAdapter attn_mask) and/or ConditioningSetMask regions,
   one chain per character, composed over a shared scene conditioning. This
   maps 1:1 onto our structured request: each character block becomes its own
   adapter+mask chain (sceneRole -> region mask); the scene block becomes the
   base conditioning. NOT CLAIMED AS WORKING until a deterministic test
   request reaches a real workflow - this is the mechanism, not a result.
7. **Components available today: none.** Everything below must be installed.
8. **Python 3.13.7** is on PATH; the portable ComfyUI build ships its own
   embedded Python, so system Python is not a blocker either way.
9. **Disk:** Q: has 1597 GB free, C: has 204 GB free. Install root
   Q:\AI\ComfyUI recommended (plenty of space, keeps AI stack off C:).

## Exact gaps before a two-character test (install list, NOT installed)

| Component | Source | Size | License | Purpose |
|---|---|---|---|---|
| ComfyUI Windows portable | github.com/comfyanonymous/ComfyUI releases | ~1.9 GB download / ~7 GB on disk (embedded Python + CUDA torch) | GPL-3.0 (code) | Engine + API server |
| SDXL base 1.0 checkpoint | huggingface.co/stabilityai/stable-diffusion-xl-base-1.0 | ~6.9 GB | CreativeML Open RAIL++-M | Base image model (neutral setup default; final checkpoint choice is Trey's) |
| ComfyUI_IPAdapter_plus custom node | github.com/cubiq/ComfyUI_IPAdapter_plus | ~5 MB | GPL-3.0 | Per-character reference conditioning with attention masks |
| IPAdapter FaceID SDXL weights | huggingface.co/h94/IP-Adapter-FaceID | ~1.1 GB | Apache-2.0 (weights; non-commercial flag on some variants - verify per file) | Face identity from reference images |
| CLIP-Vision ViT-H image encoder | huggingface.co/h94/IP-Adapter | ~2.4 GB | Apache-2.0 | Required by IPAdapter |
| InsightFace models (buffalo_l/antelopev2) | github.com/deepinsight/insightface | ~0.6 GB | MIT (code); model files research-license - verify | Face embedding for FaceID |
| Optional: InstantID node + weights | github.com/cubiq/ComfyUI_InstantID + huggingface.co/InstantX/InstantID | ~2.1 GB | Apache-2.0 | Stronger single-shot identity lock (alternative/addition to FaceID) |

Total first install: roughly 13-19 GB on Q: (1.6 TB free - no constraint).
License caveats to resolve before commercial use: RAIL++-M content
restrictions on SDXL base, and the research/non-commercial flags on some
FaceID/InsightFace files. For a paid product these must be checked per file;
several commercially-licensed checkpoint alternatives exist and the choice is
Trey's.

## Additional real gap: reference images do not exist yet

Reference packs today hold refs like asset://nova-face-v1 as metadata only -
there are no actual reference image files. The bootstrap path: generate
single-character neutral portraits first (SFW, per mission rules), have Trey
approve them as the canonical Nova/Iris references, store them as real files
bound to the reference packs, THEN run the two-character test against those
references. Identity consistency needs an anchor; the anchor must exist first.

## Proposed first two-character test workflow (SFW, deterministic)

Graph (ComfyUI API-format JSON, one node id per step):

1. CheckpointLoaderSimple - SDXL base
2. CLIPTextEncode (positive): scene block only - "two adults standing in a
   sunlit park, medium two-shot, eye level" (from scene.setting/composition;
   neutral test content)
3. CLIPTextEncode (negative): standard quality negatives
4. LoadImage A: Nova reference (from reference pack file)
5. LoadImage B: Iris reference
6. Mask A: left half of canvas (from sceneRole "left foreground")
7. Mask B: right half (sceneRole "right foreground")
8. IPAdapterFaceID chain A: model + ref A + attn_mask A, weight ~0.8
9. IPAdapterFaceID chain B: chained after A, ref B + attn_mask B, weight ~0.8
10. KSampler: fixed seed (deterministic), ~30 steps, cfg ~6
11. VAEDecode -> SaveImage

Success criteria for the test (matches our validator report shape): two
distinct people present; person in left region matches reference A, right
matches reference B; no feature merging. First validation pass is human (Trey)
plus our scripted-report tooling; automated identity scoring (face embedding
against the reference packs) is the milestone after the adapter works.

The adapter contract: ComfyUIImageProvider implements generateFromScene() by
template-filling this graph from the structured request (per-character blocks
-> per-character chains; sceneRole -> mask region; scene block -> base
conditioning), POSTs to /prompt, polls /history, returns the output reference.
supportsSceneRequests=true only lands with that adapter, and multi-character
support is claimed only after the deterministic test produces a real image
that passes review.

## Final result

- done (inspection + design). Nothing installed, nothing generated, nothing
  committed. Awaiting Trey's approval of the install list (components, sizes,
  sources, licenses, Q:\AI\ComfyUI root) before any download.

## Next action

- Trey approves/edits the install list (especially checkpoint choice and the
  license caveats), then the install lane runs: ComfyUI core -> nodes ->
  weights -> API smoke test -> single-character reference portraits ->
  two-character deterministic test.
