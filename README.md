# OGZNSFW

Private subscription-based companion platform for fictional consenting adults.
MVP vertical slice: demo account -> one companion -> memory-aware chat ->
structured memories -> image generation -> private gallery.

## Hard platform rules (enforced in code, tested in tests/)

- Fictional adults only. Characters require an explicit integer age >= 18 and
  a fictional attestation; ambiguous age fails closed.
- Requests involving minors, non-consent, or real-person likeness are blocked
  before any provider is called.
- Every record (characters, memories, conversation turns, assets) is scoped by
  tenant; cross-tenant access returns 404/empty, never data.
- No mock data anywhere in the runtime. Unconfigured providers produce honest
  503 "not configured" states with setup instructions.

## Layout

```
apps/web/                 static frontend (dark, chat-dominant)
apps/api/                 Express API + demo seed
packages/character-core/  canonical character record, versioning, prompt compiler
packages/memory/          structured memories, extraction interface, retrieval
packages/providers/       ProviderRegistry + real adapters (chat: Ollama; image: HuggingFace)
packages/safety/          safety gates (text + character validation)
db/                       JSON-file store (swap target: SQLite/Postgres)
tests/                    node:test suite; test fixtures live ONLY here
orchestration/            agent build/verify control plane (not the product)
```

## Run

```
npm install
npm start
```

Open http://127.0.0.1:3000 - pass the age gate, and the demo tenant plus the
seeded companion (Nova, 27, fictional) load automatically.

Without providers configured the UI shows honest "not configured" banners and
disables chat/generation. To make chat live:

1. `ollama pull <model>` (pick your model; none are pulled by default)
2. Copy `.env.example` to `.env`, set `CHAT_PROVIDER=ollama`,
   `OLLAMA_URL=http://127.0.0.1:11434`, `OLLAMA_MODEL=<model>`
3. Restart. `GET /api/providers?probe=1` reports live reachability; nothing is
   claimed as connected without a successful probe round-trip.

Image generation: set `IMAGE_PROVIDER=huggingface`, `HF_TOKEN`, and
`HF_IMAGE_MODEL`. The ComfyUI adapter is planned (listed in the registry as
not implemented).

## Test

```
npm test
```

Covers: character version loading, character safety validation, tenant
isolation, memory save/retrieval/extraction/use-in-chat, chat and image
provider swap, registry env selection, honest unconfigured 503s, blocked
unsafe requests, and a guard test that no runtime file imports test fixtures
or defines a mock provider.

## Provider pattern

Ported from OGZPMLV2's BrokerRegistry/IBrokerAdapter: a declarative
`ProviderRegistry` with per-adapter metadata (`requiredEnv`, `capabilities`,
`implemented`) and one factory as the single selection path. Adding a provider
= one adapter class + one registry entry.

## Not in this MVP (deliberate)

Real accounts/auth, Stripe billing (subscription state placeholder only),
voice/video, model fine-tuning, semantic moderation (current gates are
pattern-based and fail closed; model-based moderation is a later milestone),
embedding/RAG retrieval (interface is in place), ComfyUI adapter, VPS deploy.
