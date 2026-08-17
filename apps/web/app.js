// OGZNSFW MVP frontend. Plain JS, no framework, no fabricated data:
// everything on screen comes from the API or is an honest empty/error state.
const state = { tenantId: null, characterId: null, chatConfigured: false, imageConfigured: false };

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.tenantId) headers['X-Tenant-Id'] = state.tenantId;
  const res = await fetch(path, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

// --- age gate
function initAgeGate() {
  if (localStorage.getItem('ogznsfw-adult') === 'yes') {
    $('age-gate').classList.add('hidden');
    $('app').classList.remove('hidden');
    return true;
  }
  $('age-confirm').addEventListener('click', () => {
    localStorage.setItem('ogznsfw-adult', 'yes');
    $('age-gate').classList.add('hidden');
    $('app').classList.remove('hidden');
    boot();
  });
  return false;
}

// --- providers
async function loadProviders() {
  const { body } = await api('/api/providers?probe=1');
  const chat = body.chat ?? {};
  const image = body.image ?? {};
  state.chatConfigured = !!chat.configured && !!chat.probe?.reachable;
  state.imageConfigured = !!image.configured && !!image.probe?.reachable;
  const fmt = (kind, p) => p.configured
    ? `${kind}: ${p.provider} (${p.probe?.reachable ? 'reachable' : 'UNREACHABLE: ' + (p.probe?.detail ?? 'unknown')})`
    : `${kind}: not configured`;
  $('provider-status').textContent = `${fmt('chat', chat)} | ${fmt('image', image)}`;

  if (!state.chatConfigured) {
    const banner = $('chat-banner');
    banner.classList.remove('hidden');
    banner.textContent = chat.configured
      ? `Chat provider "${chat.provider}" is unreachable: ${chat.probe?.detail ?? ''}`
      : `No chat provider configured. ${chat.reason ?? ''}`;
    $('chat-send').disabled = true;
    $('chat-input').disabled = true;
  }
  if (!state.imageConfigured) {
    const banner = $('gallery-banner');
    banner.classList.remove('hidden');
    banner.textContent = image.configured
      ? `Image provider "${image.provider}" is unreachable: ${image.probe?.detail ?? ''}`
      : `No image provider configured. ${image.reason ?? ''}`;
    $('image-send').disabled = true;
    $('image-prompt').disabled = true;
  }
}

// --- profile
async function loadProfile() {
  const { ok, body } = await api(`/api/characters/${state.characterId}`);
  if (!ok) { $('profile').textContent = 'failed to load character'; return; }
  const r = body.record;
  $('profile').innerHTML = `
    <div class="name">${esc(r.identity.name)}</div>
    <div>${r.identity.age} / ${esc(r.identity.gender)} / fictional / v${body.version}</div>
    <div class="section">Personality</div><div class="val">${esc(r.personality.join(', '))}</div>
    <div class="section">Style</div><div class="val">${esc(r.speakingStyle)}</div>
    <div class="section">Appearance</div><div class="val">${esc(Object.values(r.appearance).filter(Boolean).join('; '))}</div>
    <div class="section">Relationship</div><div class="val">${esc(r.relationshipState.stage)} (trust ${r.relationshipState.trust}/10)</div>
    <div class="section">Mood</div><div class="val">${esc(r.currentState.mood)}</div>`;
}

function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

// --- chat
function addMsg(role, text, meta) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  if (meta) {
    const m = document.createElement('span');
    m.className = 'meta';
    m.textContent = meta;
    div.appendChild(m);
  }
  $('chat-log').appendChild(div);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
}

async function loadHistory() {
  const { ok, body } = await api(`/api/chat/history?characterId=${state.characterId}`);
  if (ok) for (const t of body) addMsg(t.role, t.content);
}

async function sendChat(ev) {
  ev.preventDefault();
  const message = $('chat-input').value.trim();
  if (!message) return;
  $('chat-input').value = '';
  addMsg('user', message);
  $('chat-send').disabled = true;
  const { ok, status, body } = await api('/api/chat', { method: 'POST', body: JSON.stringify({ characterId: state.characterId, message }) });
  $('chat-send').disabled = !state.chatConfigured;
  if (ok) {
    addMsg('assistant', body.reply, `${body.provider}/${body.model}` + (body.usedMemories.length ? ` | memories used: ${body.usedMemories.length}` : ''));
    if (body.newMemories.length) loadMemories();
  } else if (status === 422 && body.blocked) {
    addMsg('blocked', `Blocked (${body.category}): ${body.error}`);
  } else {
    addMsg('blocked', `Error ${status}: ${body.error ?? 'unknown'} ${body.detail ?? body.how ?? ''}`);
  }
}

// --- memories
async function loadMemories() {
  const { ok, body } = await api(`/api/memories?characterId=${state.characterId}`);
  const el = $('memories');
  if (!ok) { el.textContent = 'failed to load memories'; return; }
  if (!body.length) { el.textContent = 'none yet'; return; }
  el.innerHTML = body.map((m) => `<div class="memory"><span class="kind">${esc(m.kind)} / importance ${m.importance}</span><br>${esc(m.content)}</div>`).join('');
}

// --- gallery
async function loadGallery() {
  const { ok, body } = await api(`/api/assets?characterId=${state.characterId}`);
  const el = $('gallery');
  if (!ok) { el.textContent = 'failed to load assets'; return; }
  if (!body.length) { el.textContent = 'no assets yet'; return; }
  el.innerHTML = body.map((a) => `<figure><img src="${a.uri}" alt="generated asset"><figcaption>${esc(a.provider)}/${esc(a.model)}</figcaption></figure>`).join('');
}

async function sendImage(ev) {
  ev.preventDefault();
  const prompt = $('image-prompt').value.trim();
  if (!prompt) return;
  $('image-send').disabled = true;
  const { ok, status, body } = await api('/api/assets', { method: 'POST', body: JSON.stringify({ characterId: state.characterId, prompt }) });
  $('image-send').disabled = !state.imageConfigured;
  if (ok) {
    $('image-prompt').value = '';
    loadGallery();
  } else if (status === 422 && body.blocked) {
    const banner = $('gallery-banner');
    banner.classList.remove('hidden');
    banner.textContent = `Blocked (${body.category}): ${body.error}`;
  } else {
    const banner = $('gallery-banner');
    banner.classList.remove('hidden');
    banner.textContent = `Error ${status}: ${body.error ?? 'unknown'} ${body.detail ?? body.how ?? ''}`;
  }
}

// --- boot
async function boot() {
  const { ok, body } = await api('/api/auth/demo', { method: 'POST' });
  if (!ok) { $('provider-status').textContent = 'API unreachable'; return; }
  state.tenantId = body.tenantId;
  state.characterId = body.characterId;
  $('user-badge').textContent = `tenant: ${body.name}`;
  await loadProviders();
  await Promise.all([loadProfile(), loadHistory(), loadMemories(), loadGallery()]);
}

$('chat-form').addEventListener('submit', sendChat);
$('image-form').addEventListener('submit', sendImage);
if (initAgeGate()) boot();
