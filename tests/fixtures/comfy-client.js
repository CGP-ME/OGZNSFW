// TEST FIXTURE ONLY. Fake ComfyUI HTTP client - no network, deterministic.
// Captures every posted workflow so tests can assert structure. Never
// imported by runtime code.

export class FakeComfyClient {
  constructor(opts = {}) {
    this.postedWorkflows = [];
    this.failMode = opts.failMode ?? null; // 'unreachable' | 'reject' | 'no-id' | 'exec-error' | 'no-output' | 'empty-bytes'
    this.version = opts.version ?? '0.33.1-test';
  }
  async getJson(path) {
    if (this.failMode === 'unreachable') throw new Error('ECONNREFUSED (test fixture)');
    if (path === '/system_stats') return { system: { comfyui_version: this.version } };
    if (path.startsWith('/history/')) {
      const id = path.split('/').pop();
      if (this.failMode === 'exec-error') return { [id]: { status: { completed: false, status_str: 'error', messages: [['execution_error', { detail: 'test failure' }]] } } };
      if (this.failMode === 'no-output') return { [id]: { status: { completed: true, status_str: 'success' }, outputs: {} } };
      return { [id]: { status: { completed: true, status_str: 'success' }, outputs: { 9: { images: [{ filename: 'fixture_output.png', subfolder: '', type: 'output' }] } } } };
    }
    throw new Error(`unexpected GET ${path}`);
  }
  async postJson(path, body) {
    if (this.failMode === 'unreachable') throw new Error('ECONNREFUSED (test fixture)');
    if (path === '/prompt') {
      this.postedWorkflows.push(body.prompt);
      if (this.failMode === 'reject') return { node_errors: { 3: { errors: ['bad input (test fixture)'] } } };
      if (this.failMode === 'no-id') return {};
      return { prompt_id: 'fixture-prompt-1', node_errors: {} };
    }
    throw new Error(`unexpected POST ${path}`);
  }
  async getBytes() {
    if (this.failMode === 'empty-bytes') return Buffer.alloc(0);
    return Buffer.from('fixture-png-bytes');
  }
}
