// Test helper: boots the real app against a throwaway temp data dir on an
// ephemeral port. Uses the actual server, store, and packages - only the
// providers are injected (fixtures or none).
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonStore } from '../db/store.js';
import { createApp } from '../apps/api/server.js';

export async function bootApp({ chat, image, imageValidator } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'ogznsfw-test-'));
  const store = new JsonStore(dataDir);
  const app = createApp({ store, chat, image, imageValidator });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { tenant, body } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(tenant ? { 'X-Tenant-Id': tenant } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const demo = async () => (await call('POST', '/api/auth/demo')).body;
  return { store, server, base, call, demo, close: () => new Promise((r) => server.close(r)) };
}

export function validCharacter(name = 'TestChar') {
  return {
    identity: { name, age: 25, gender: 'female', fictional: true, basedOnRealPerson: false },
    personality: ['calm'],
    speakingStyle: 'short sentences',
    appearance: { hair: 'red', eyes: 'green', build: 'slim', style: 'casual', distinguishing: 'none' },
    boundaries: { hard: ['no minors'], soft: [] },
    relationshipState: { stage: 'new', trust: 1, notes: '' },
    currentState: { mood: 'neutral', context: '' },
  };
}
