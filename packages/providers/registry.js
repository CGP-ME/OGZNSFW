// ProviderRegistry - master registry of provider implementations with
// metadata, ported from OGZPMLV2's BrokerRegistry pattern: declarative
// entries, capability metadata, one factory as the single source of truth.
//
// No mock providers exist. If selection fails, the factory returns an honest
// { provider: null, status } and the API surfaces "not configured" - it never
// fabricates output.
import { OllamaChatProvider } from './chat/index.js';
import { HuggingFaceImageProvider } from './image/index.js';

export const ProviderRegistry = {
  chat: {
    ollama: {
      name: 'Ollama',
      description: 'Local model server for chat (uncensored local models supported)',
      requiredEnv: ['OLLAMA_URL', 'OLLAMA_MODEL'],
      capabilities: ['local', 'no-cloud', 'model-choice'],
      implemented: true,
      create: (env) => new OllamaChatProvider(env.OLLAMA_URL, env.OLLAMA_MODEL),
    },
  },
  image: {
    huggingface: {
      name: 'Hugging Face Inference API',
      description: 'Hosted image generation via HF inference endpoints',
      requiredEnv: ['HF_TOKEN', 'HF_IMAGE_MODEL'],
      capabilities: ['hosted', 'model-choice'],
      implemented: true,
      create: (env) => new HuggingFaceImageProvider(env.HF_TOKEN, env.HF_IMAGE_MODEL),
    },
    comfyui: {
      name: 'ComfyUI',
      description: 'Local ComfyUI workflow-based generation (planned adapter)',
      requiredEnv: ['COMFYUI_URL'],
      capabilities: ['local', 'workflows', 'character-reference'],
      implemented: false,
      create: null,
    },
  },
};

function select(kind, selectedKey, env) {
  const entries = ProviderRegistry[kind];
  if (!selectedKey) {
    return { provider: null, status: { configured: false, selected: null, reason: `no ${kind} provider selected; set ${kind.toUpperCase()}_PROVIDER in .env`, available: Object.keys(entries) } };
  }
  const entry = entries[selectedKey];
  if (!entry) {
    return { provider: null, status: { configured: false, selected: selectedKey, reason: `unknown ${kind} provider "${selectedKey}"; available: ${Object.keys(entries).join(', ')}` } };
  }
  if (!entry.implemented) {
    return { provider: null, status: { configured: false, selected: selectedKey, reason: `${entry.name} adapter is not implemented yet` } };
  }
  const missing = entry.requiredEnv.filter((k) => !env[k]);
  if (missing.length) {
    return { provider: null, status: { configured: false, selected: selectedKey, reason: `missing env for ${entry.name}: ${missing.join(', ')}` } };
  }
  return { provider: entry.create(env), status: { configured: true, selected: selectedKey, reason: null } };
}

export function createChatProvider(env = process.env) {
  return select('chat', env.CHAT_PROVIDER, env);
}

export function createImageProvider(env = process.env) {
  return select('image', env.IMAGE_PROVIDER, env);
}

export function registryInfo() {
  const info = {};
  for (const kind of Object.keys(ProviderRegistry)) {
    info[kind] = Object.fromEntries(Object.entries(ProviderRegistry[kind]).map(([key, e]) => [key, {
      name: e.name, description: e.description, requiredEnv: e.requiredEnv, capabilities: e.capabilities, implemented: e.implemented,
    }]));
  }
  return info;
}
