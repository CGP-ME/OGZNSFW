// ImageProvider interface + real implementations. Same swap pattern as chat.
// No mock in runtime: unconfigured means an honest "not configured" state.
// A ComfyUI adapter is a later milestone and implements this same class.

export class ImageProvider {
  get name() { throw new Error('name must be implemented'); }
  // Returns { uri, provider, model } where uri is a data: URI or a served path.
  // eslint-disable-next-line no-unused-vars
  async generate({ prompt, characterRecord }) {
    throw new Error('generate() must be implemented');
  }
  async probe() { throw new Error('probe() must be implemented'); }
}

// Hugging Face Inference API provider. Never claimed reachable unless probe()
// completes a real round-trip.
export class HuggingFaceImageProvider extends ImageProvider {
  constructor(token, model) {
    super();
    if (!token || !model) throw new Error('HuggingFaceImageProvider requires token and model');
    this.token = token;
    this.model = model;
  }
  get name() { return 'huggingface'; }
  async generate({ prompt, characterRecord }) {
    const a = characterRecord?.appearance ?? {};
    const characterRef = [a.hair && `${a.hair} hair`, a.eyes && `${a.eyes} eyes`, a.build, a.style, a.distinguishing]
      .filter(Boolean).join(', ');
    const fullPrompt = characterRef ? `${prompt}. Character reference: ${characterRef}` : prompt;
    const res = await fetch(`https://api-inference.huggingface.co/models/${this.model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: fullPrompt }),
    });
    if (!res.ok) throw new Error(`HuggingFace HTTP ${res.status}: ${await res.text()}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || 'image/png';
    return { uri: `data:${type};base64,${buf.toString('base64')}`, provider: this.name, model: this.model };
  }
  async probe() {
    try {
      const res = await fetch(`https://huggingface.co/api/models/${this.model}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(8000),
      });
      return { reachable: res.ok, detail: `model endpoint HTTP ${res.status}` };
    } catch (err) {
      return { reachable: false, detail: err.message };
    }
  }
}
