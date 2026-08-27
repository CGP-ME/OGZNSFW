# Character LoRA Training Plan (RTX 4090) - v1, NOT YET EXECUTED

Status: PLAN ONLY. No training has run. No tools or models beyond the
committed Phase 1 stack are installed. Blockers listed at the end.

## Base model

- sd_xl_base_1.0.safetensors (installed, hash 31E35C80FC4829D14F90153F4C74CD5
  9C90B779F6AFE05A74CD6120B893F7E5B, CreativeML Open RAIL++-M).
- License check: RAIL++-M Section II grants rights over the Model AND
  Derivatives of the Model with the same use restrictions - training LoRAs is
  permitted; outputs/derivatives carry the same Attachment A restrictions we
  already enforce in code.

## Training tool (NOT installed - report-first gate applies)

- Proposed: kohya-ss/sd-scripts (Apache-2.0), the standard SDXL LoRA trainer.
  Install would be: git clone + Python venv + pinned requirements (torch cu***
  already available system-wide is NOT reused - venv isolated), roughly 2-4 GB
  with dependencies. Exact source, revision, and sizes will be reported for
  approval before any install, per standing rule.
- Alternative (zero new installs, weaker control): ComfyUI LoRA-training
  custom nodes - rejected for now: less reproducible CLI provenance.

## Per-character run configuration (initial)

| Field | Value | Note |
|---|---|---|
| rank / alpha | 16 / 16 | identity-only target; raise to 32 only on evidence |
| unet LR | 1e-4 cosine | conservative SDXL LoRA default |
| text-encoder LR | 5e-5 (TE1 only) | trigger-token binding |
| steps | ~2000 (24 imgs x ~85 repeats-equivalent) | early-stop on eval drift |
| resolution | 1024, bucketed | matches generation |
| batch | 2 + grad accumulation 2 | fits 4090 |
| VRAM estimate | 17-21 GB peak | 24 GB card; Ollama must be cold during training |
| precision | bf16 | |
| seed | fixed per run, recorded | reproducibility |
| output | ~50 MB .safetensors | |
| paths | Q:\AI\training\<characterId>\v<version>\r<revision>\ (dataset, cache, output, logs) | |
| caption policy | trigger-plus-variables: "novaident woman, <wardrobe>, <background>, <lighting>, <pose>" - invariant identity NEVER captioned so it binds to the trigger | |
| trigger tokens | novaident / irisident | rare-token style |

Rollback/versioning: revisions are append-only files + provenance records
(training/schemas/lora-provenance.schema.json); the active revision is a
pointer in the character record, so rollback = pointer change, never deletion.

## Dataset requirements (gate before training)

Per character spec (training/characters/*.spec.json): >=16 approved training
images + >=6 approved evaluation images, varied wardrobe/background/lighting/
pose per the spec's reference-pack requirements, audited by
training/audit-dataset.mjs (duplicates, approvals, licensing, split
disjointness, trigger-token captions). SFW for this lane. Anchor images will
be generated locally (two-pass pipeline, single-character mode) and approved
by Trey before entering the manifest.

## Validation benchmark (gate before production use)

Evaluation set per LoRA - all UNSEEN by training:
1. neutral portrait, 2. alternate wardrobe, 3. alternate background,
4. alternate lighting, 5. three-quarter view, 6. wider framing,
7. two-character scene (LoRA in the two-pass refinement pass),
8. seed variation (3 seeds per case).
Scored on: identity similarity, character presence, identity drift, wardrobe
leakage, background leakage, anatomy/artifact warnings, prompt adherence.
Review is human (Trey + me) - no CV claimed. validation.status=passed
requires the full set, never one good image; loraUsableForPublication()
enforces this in code.

## Integration target

Two-pass compositor refinement pass: per-character branch becomes
LoraLoader(character LoRA) -> IPAdapter(optional, reduced weight) -> regional
refinement. Provenance carries characterLoraRef fields (packages/generation/lora.js).

## Blockers (in order)

1. Trey approves Nova/Iris canon specs (drafted, status draft-pending-trey-approval).
2. Anchor-set generation mission (SFW, two-pass single-character, ~30 candidates each) + Trey approval pass into manifests.
3. Report-first approval for kohya-ss/sd-scripts install (source/revision/size/license/SHA on the pinned requirements).
4. Training runs (Nova first, then Iris), provenance records, validation benchmark.
