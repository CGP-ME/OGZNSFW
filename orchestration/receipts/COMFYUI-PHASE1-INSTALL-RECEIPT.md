# Receipt: M-20260818-003 (ComfyUI Phase 1 Install + Smoke Tests)

- Mission ID: M-20260818-003
- Date/time: 2026-08-18 (machine local, UTC-7)
- Requester: Trey (explicit APPROVED prompt with conditions)
- Assigned agent: Fable (Claude Code session, model claude-fable-5)
- Objective: Install the approved Phase 1 stack to Q:\AI\ComfyUI, verify the
  API, run one SFW single-character smoke test and one SFW two-character
  test with separate references and left/right roles. SFW throughout.
- Conditions honored: Phase 1 components only; no NSFW checkpoints; no
  FaceID/InsightFace/InstantID/PuLID; no LoRA training; OGZNSFW source
  untouched; not connected to OGZNSFW; no VPS; nothing staged/committed/pushed.

## Download manifest (recorded per approval terms)

| File | Source URL | Version/revision | License | Size | SHA-256 |
|---|---|---|---|---|---|
| ComfyUI_windows_portable_nvidia.7z | github.com/Comfy-Org/ComfyUI/releases/download/v0.33.1/ComfyUI_windows_portable_nvidia.7z | v0.33.1 (2026-08-13) | GPL-3.0 | 2,034.3 MB | 4A221588979B96B8244E0E50B2EDCA03AF732ACAE1DEBA69D60AA3B4D60B9DBA |
| sd_xl_base_1.0.safetensors | huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors | main @ 2026-08-18 | CreativeML Open RAIL++-M | 6,616.7 MB | 31E35C80FC4829D14F90153F4C74CD59C90B779F6AFE05A74CD6120B893F7E5B (matches HF-published hash) |
| CLIP-ViT-H image encoder (model.safetensors) | huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors | main @ 2026-08-18 | Apache-2.0 | 2,411.2 MB | 6CA9667DA1CA9E0B0F75E46BB030F7E011F44F86CBFB8D5A36590FCD7507B030 |
| ip-adapter_sdxl_vit-h.safetensors | huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter_sdxl_vit-h.safetensors | main @ 2026-08-18 | Apache-2.0 | 666.0 MB | EBF05D918348AEC7ABB02A5E9ECEF77E0AAEA6914A5C4EA13F50D45EB1681831 |
| ip-adapter-plus_sdxl_vit-h.safetensors | huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors | main @ 2026-08-18 | Apache-2.0 | 808.3 MB | 3F5062B8400C94B7159665B21BA5C62ACDCD7682262743D7F2AEFEDEF00E6581 |
| ComfyUI_IPAdapter_plus (git clone) | github.com/cubiq/ComfyUI_IPAdapter_plus | commit a0f451a5113cf9becb0847b92884cb10cbdec0ef (2025-04-14) | GPL-3.0 | ~5 MB | n/a (git revision recorded) |

Install root: Q:\AI\ComfyUI (portable). Model placement:
ComfyUI\models\checkpoints\sd_xl_base_1.0.safetensors;
models\clip_vision\CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors;
models\ipadapter\{ip-adapter_sdxl_vit-h, ip-adapter-plus_sdxl_vit-h};
custom_nodes\ComfyUI_IPAdapter_plus. Only the one custom node was installed.

## Runtime verification

- Server: Q:\AI\ComfyUI\python_embeded\python.exe -s ComfyUI\main.py
  --windows-standalone-build --listen 127.0.0.1 --port 8188
- API verified: GET /system_stats -> ComfyUI 0.33.1, PyTorch 2.13.0+cu130,
  Python 3.13.14 (embedded), RTX 4090 24564 MB detected, DynamicVRAM on.
- Node registration verified via /object_info: IPAdapterUnifiedLoader,
  IPAdapterAdvanced present; sd_xl_base_1.0.safetensors visible to
  CheckpointLoaderSimple. Workflow node parameters were taken from
  /object_info, not guessed.

## Smoke test 1: single character (SFW)

- Workflow: SDXL text2img, seed 424242, 25 steps, cfg 6.5, 1024x1024,
  prompt "professional portrait photograph of a confident adult woman, jet
  black undercut hair, gray eyes, dark techwear jacket, neutral studio
  background..." Negative includes child/teenager exclusions.
- Result: SUCCESS. output\ogznsfw_smoke1_single_00001_.png, visually
  verified: single adult woman matching the prompt. Warm generation speed
  ~7.4 it/s (25 steps in ~3.4 s).
- A second distinct portrait (seed 777777, auburn hair, green eyes, olive
  blouse) generated as reference B: ogznsfw_smoke1_refB_00001_.png, verified
  distinct from A.

## Smoke test 2: two characters, separate references, left/right roles (SFW)

- References: refA.png (smoke1 output), refB.png staged into ComfyUI\input.
- Workflow (scratchpad smoke2-twochar.json, deterministic seed 20260818,
  30 steps): SDXL base -> IPAdapterUnifiedLoader "PLUS (high strength)" ->
  two chained IPAdapterAdvanced nodes, each with its own reference image and
  its own SolidMask/MaskComposite attention mask (A: left 512x1024 region,
  B: right), weight 0.8 linear, scene-level prompt kept separate ("two adult
  women standing side by side in a sunlit park, medium two-shot...").
- Result: SUCCESS on the mission criteria, verified visually on
  output\ogznsfw_smoke2_twochar_00001_.png:
  - two people present: YES
  - reference A identity on the LEFT: YES (black undercut, leather jacket)
  - reference B identity on the RIGHT: YES (long auburn hair, olive blouse)
  - characters remain distinct, no feature merging: YES
- Execution: 23.78 s including first CLIP-Vision load.

## Honest limitations (explicitly NOT claimed)

- This demonstrates regional reference conditioning (the plumbing), NOT
  production-grade identity locking. Per-character LoRAs (Phase 2) remain the
  identity mechanism for the product.
- Known quality flaws in the test output: a visible hard vertical seam at the
  mask boundary, and the park setting lost to the references' studio
  backgrounds (adapter weight pulled background style in). Known remedies for
  the adapter lane: mask feathering/overlap, weight/weight_type tuning
  (e.g. style transfer variants), background-targeted conditioning.
- No automated identity scoring exists; this pass is human visual review.
- ComfyUI GPL-3.0 note preserved: local server use is fine; distributing a
  modified/bundled ComfyUI is a different legal situation - Legal review
  required before shipping any packaged ComfyUI product.

## Git / connection status

- Nothing staged, committed, or pushed. OGZNSFW source untouched. ComfyUI is
  NOT connected to the OGZNSFW provider layer yet.
- Ollama note: qwen3:14b and SDXL share the 4090; both ran fine in this
  session (SDXL ~10.5 GB peak with adapters), but simultaneous heavy load is
  untested.

## Final result

- done - Phase 1 installed with full provenance, API verified, both smoke
  tests passed on their stated criteria, evidence images on disk.

## Next action

- Trey reviews the two-character evidence image. Then the next lane is the
  ComfyUIImageProvider adapter (generateFromScene() template-filling this
  exact workflow shape, supportsSceneRequests=true), plus seam/background
  tuning, followed by canonical anchor approval and Phase 2 LoRA training as
  separate decisions.
