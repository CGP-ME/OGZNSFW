// TEST FIXTURES ONLY. These fake providers exist so the interface contract
// and swap mechanics are testable without external services. They are never
// imported by runtime code (enforced by tests/no-fixtures-in-runtime rule in
// providers.test.js). Production has NO mock providers: unconfigured means an
// honest 503.
import { ChatProvider } from '../../packages/providers/chat/index.js';
import { ImageProvider } from '../../packages/providers/image/index.js';

export class FixtureChatA extends ChatProvider {
  get name() { return 'fixture-chat-a'; }
  async chat(systemPrompt, history, userMessage) {
    return { reply: `A:${userMessage}`, provider: this.name, model: 'fixture' };
  }
  async probe() { return { reachable: true, detail: 'test fixture' }; }
}

export class FixtureChatB extends ChatProvider {
  get name() { return 'fixture-chat-b'; }
  async chat() { return { reply: 'B', provider: this.name, model: 'fixture' }; }
  async probe() { return { reachable: true, detail: 'test fixture' }; }
}

export class FixtureImageA extends ImageProvider {
  get name() { return 'fixture-image-a'; }
  async generate() { return { uri: 'data:text/plain;base64,QQ==', provider: this.name, model: 'fixture' }; }
  async probe() { return { reachable: true, detail: 'test fixture' }; }
}

export class FixtureImageB extends ImageProvider {
  get name() { return 'fixture-image-b'; }
  async generate() { return { uri: 'data:text/plain;base64,Qg==', provider: this.name, model: 'fixture' }; }
  async probe() { return { reachable: true, detail: 'test fixture' }; }
}

// Scene-capable image fixture: accepts a structured multi-character request
// and returns a deterministic output reference. It records the request it
// received so tests can assert nothing was flattened.
export class FixtureSceneImageProvider extends ImageProvider {
  constructor() { super(); this.lastRequest = null; }
  get name() { return 'fixture-scene-image'; }
  get supportsSceneRequests() { return true; }
  async generate() { return { uri: 'data:text/plain;base64,Uw==', provider: this.name, model: 'fixture' }; }
  async generateFromScene(request) {
    this.lastRequest = request;
    return { uri: `about:fixture-scene-output/${request.sceneId}`, provider: this.name, model: 'fixture-scene' };
  }
  async probe() { return { reachable: true, detail: 'test fixture' }; }
}

export const configuredChat = (p) => ({ provider: p, status: { configured: true, selected: p.name, reason: null } });
export const configuredImage = (p) => ({ provider: p, status: { configured: true, selected: p.name, reason: null } });
export const unconfigured = (kind) => ({ provider: null, status: { configured: false, selected: null, reason: `no ${kind} provider selected (test)` } });
