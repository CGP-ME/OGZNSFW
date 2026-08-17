// ChatProvider interface + real implementations. The API layer only touches
// the interface, so swapping providers is a config change (pattern ported
// from OGZPMLV2's IBrokerAdapter/BrokerRegistry).
//
// There is deliberately NO mock provider here. If nothing is configured, the
// app shows an honest "no provider configured" state. Test fakes live under
// tests/fixtures/ and never ship in a runtime path.

export class ChatProvider {
  get name() { throw new Error('name must be implemented'); }
  // eslint-disable-next-line no-unused-vars
  async chat(systemPrompt, history, userMessage) {
    throw new Error('chat() must be implemented');
  }
  // Live connectivity check. Must never lie: only returns reachable=true
  // after a real round-trip to the backing service.
  async probe() { throw new Error('probe() must be implemented'); }
}

export class OllamaChatProvider extends ChatProvider {
  constructor(baseUrl, model) {
    super();
    if (!baseUrl || !model) throw new Error('OllamaChatProvider requires baseUrl and model');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
  }
  get name() { return 'ollama'; }
  async chat(systemPrompt, history, userMessage) {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: userMessage },
    ];
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // think:false keeps reasoning models (qwen3) in direct-reply mode for
      // conversational latency; keep_alive holds the model warm between turns.
      body: JSON.stringify({ model: this.model, messages, stream: false, think: false, keep_alive: '30m' }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { reply: data.message?.content ?? '', provider: this.name, model: this.model };
  }
  async probe() {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { reachable: false, detail: `HTTP ${res.status}` };
      const data = await res.json();
      const models = (data.models ?? []).map((m) => m.name);
      return {
        reachable: true,
        detail: `models available: ${models.join(', ') || 'none'}`,
        hasModel: models.some((m) => m === this.model || m.startsWith(this.model + ':')),
      };
    } catch (err) {
      return { reachable: false, detail: err.message };
    }
  }
}
