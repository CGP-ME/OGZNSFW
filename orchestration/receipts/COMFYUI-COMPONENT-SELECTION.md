# Receipt: M-20260818-002 (ComfyUI Component and License Selection)

- Mission ID: M-20260818-002
- Date/time: 2026-08-18 (machine local, UTC-7)
- Requester: Trey
- Assigned agent: Fable (Claude Code session, model claude-fable-5)
- Objective: Select commercially usable checkpoint/identity components for the
  ComfyUI backend, with each load-bearing license verified at its source, not
  from memory. Nothing installed or downloaded in this mission.

## License verifications (fetched from source 2026-08-18)

| Component | License | Commercial | Evidence |
|---|---|---|---|
| IP-Adapter-FaceID (h94/IP-Adapter-FaceID) | research-only | NO | Model card verbatim: "AS InsightFace pretrained models are available for non-commercial research purposes, IP-Adapter-FaceID models are released exclusively for research purposes and is not intended for commercial use." |
| InsightFace pretrained models (buffalo_l/antelopev2) | non-commercial research | NO | Same statement; poisons everything depending on them |
| InstantID / PuLID | (weights Apache) but depend on InsightFace antelopev2 | NO in practice | Dependency chain |
| IP-Adapter plain SDXL adapters (h94/IP-Adapter) incl. CLIP-Vision ViT-H encoder | Apache-2.0 | YES | HF model card license field |
| SDXL base 1.0 | CreativeML Open RAIL++-M | YES, with use restrictions | License text: perpetual royalty-free grant, no commercial prohibition; Attachment A bans illegal use, exploiting/harming minors, disinformation, harassment, etc. No blanket adult-content ban. Restrictions align with gates we already enforce in code. |
| FLUX.1-schnell | Apache-2.0 | YES | HF + multiple sources |
| Qwen-Image / Qwen-Image 2.0 (Feb 2026, 7B) | Apache-2.0 | YES | Multiple sources |
| ComfyUI engine + ComfyUI_IPAdapter_plus node | GPL-3.0 (code) | YES for our use | We run it as a local server; GPL obligations trigger on distributing ComfyUI itself, not on generated outputs or on API callers |

## Decision: what is IN the commercial stack

**Phase 1 (identity-pipeline proof, SFW):**
- Engine: ComfyUI at Q:\AI\ComfyUI (GPL-3.0, local server)
- Base checkpoint: SDXL base 1.0 (RAIL++-M, verified commercial-permitted).
  Chosen for Phase 1 because regional attention-mask multi-character tooling
  is most mature in the SDXL ecosystem.
- Identity: plain IP-Adapter SDXL (Apache-2.0) + CLIP-Vision ViT-H
  (Apache-2.0) via the IPAdapter Plus node, one adapter chain + attention
  mask per character.
- Revised Phase 1 download list: ComfyUI portable ~1.9 GB; SDXL base ~6.9 GB;
  IPAdapter Plus node ~5 MB; ip-adapter_sdxl + plus_vit-h weights ~1.5 GB;
  CLIP-Vision ViT-H ~2.4 GB. Total ~12.7 GB to Q:\AI (1.6 TB free).

**Phase 2 (durable identity mechanism):**
- Per-character LoRAs trained locally on the 4090 from Trey-approved anchor
  images. This is the strongest consistency mechanism, uses no third-party
  identity weights at all, and fits the product model perfectly: a canonical
  character version = record + reference pack + trained LoRA artifact.

**Excluded from the commercial stack (verified research-only):**
- IP-Adapter-FaceID, InstantID, PuLID, InsightFace pretrained models.

## Honest trade-off

Plain IP-Adapter is weaker at exact facial identity than the excluded FaceID
family. Phase 1 therefore proves the multi-character REGIONAL pipeline
(both present, correct sides, no merging) with commercially clean parts;
exact face lock is delivered by Phase 2 per-character LoRAs, not by
research-only shortcuts. If stronger reference-based identity is later needed,
the clean paths are: a paid InsightFace commercial license, or evaluating
Apache-licensed native multi-reference models (Qwen-Image 2.0 / OmniGen-class)
as an alternative backend.

## Open items (decisions that remain Trey's)

1. Production NSFW checkpoint: SDXL base is sufficient for anchors and the
   two-character identity test (SFW by mission rule). The eventual
   NSFW-capable checkpoint is a separate per-model license review (community
   checkpoint permission flags vary; some prohibit commercial generation
   services). Not needed to start.
2. Automated validator embeddings (later milestone): InsightFace is
   non-commercial; options are a paid InsightFace license or an alternative
   embedding stack. First validation passes are human review by design.
3. RAIL++-M is use-restricted (not pure Apache): if Trey wants zero
   use-restriction attachments end-to-end, the alternative base is
   FLUX.1-schnell or Qwen-Image 2.0 (both Apache-2.0) at the cost of the less
   mature multi-character masking ecosystem.

## Final result

- done (selection + verification). Nothing downloaded, installed, committed,
  or pushed. Awaiting Trey's approval of the Phase 1 list to begin install.

## Next action

- On approval: install sequence 3-8 from Trey's plan (ComfyUI to Q:\AI ->
  required nodes/models only -> API smoke test -> neutral SFW reference
  portraits -> Trey approves canonical anchors -> deterministic two-character
  test -> ComfyUI ImageProvider adapter).
