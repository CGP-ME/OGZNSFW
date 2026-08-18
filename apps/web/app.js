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

// --- scenes: builder + lifecycle (create -> compile -> generate -> validate -> publish)
let characterCatalog = [];

async function loadSceneCharacters() {
  const { ok, body } = await api('/api/characters');
  const el = $('scene-characters');
  if (!ok) { el.textContent = 'failed to load characters'; return; }
  characterCatalog = body;
  if (!body.length) { el.textContent = 'no characters yet'; return; }
  el.innerHTML = body.map((c, i) => `
    <div class="scene-char-row" data-idx="${i}">
      <input type="checkbox" class="sc-include" title="include in scene">
      <span class="char-name">${esc(c.record.identity.name)}</span>
      <input type="number" class="sc-version" value="${c.activeVersion}" min="1" max="${c.versions}" title="exact character version (1-${c.versions})">
      <input type="text" class="sc-role" placeholder="scene role / position">
      <input type="text" class="sc-wardrobe" placeholder="wardrobe">
      <input type="text" class="sc-pose" placeholder="pose / action">
      <input type="text" class="sc-ref" placeholder="reference asset ref (asset://...)">
    </div>`).join('');
}

function sceneBanner(text) {
  const b = $('scene-banner');
  if (!text) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  b.textContent = text;
}

async function createScene() {
  sceneBanner(null);
  const rows = [...document.querySelectorAll('.scene-char-row')].filter((r) => r.querySelector('.sc-include').checked);
  if (!rows.length) { sceneBanner('Select at least one character for the scene.'); return; }
  const characters = [];
  for (const row of rows) {
    const cat = characterCatalog[Number(row.dataset.idx)];
    const version = Number(row.querySelector('.sc-version').value);
    const ref = row.querySelector('.sc-ref').value.trim();
    // Register the supplied reference under this exact character version first
    if (ref) {
      const reg = await api(`/api/characters/${cat.id}/references`, { method: 'POST', body: JSON.stringify({ version, assets: [{ ref, kind: 'face' }] }) });
      if (!reg.ok) { sceneBanner(`Reference registration failed for ${cat.record.identity.name}: ${reg.body.error ?? reg.status}`); return; }
    }
    characters.push({
      characterId: cat.id,
      characterVersion: version,
      sceneRole: row.querySelector('.sc-role').value.trim() || 'unspecified position',
      referenceAssets: ref ? [ref] : [],
      appearanceLock: { ...cat.record.appearance, identifyingMarks: cat.record.appearance.distinguishing ? [cat.record.appearance.distinguishing] : [] },
      wardrobe: row.querySelector('.sc-wardrobe').value.trim() || undefined,
      poseAction: row.querySelector('.sc-pose').value.trim() || undefined,
      consent: { fictionalAdult: cat.record.identity.fictional === true, age: cat.record.identity.age },
    });
  }
  const { ok, body } = await api('/api/scenes', { method: 'POST', body: JSON.stringify({
    characters,
    setting: { location: $('scene-location').value.trim() },
    composition: { camera: $('scene-camera').value.trim(), lighting: $('scene-lighting').value.trim(), spatial: $('scene-spatial').value.trim() },
  }) });
  if (!ok) { sceneBanner(`Scene rejected: ${(body.details ?? [body.error]).join('; ')}`); return; }
  loadScenes();
}

async function sceneAction(sceneId, action, msgEl) {
  msgEl.textContent = '...';
  const { ok, status, body } = await api(`/api/scenes/${sceneId}/${action}`, { method: 'POST' });
  if (action === 'compile' && ok) {
    const pre = $('scene-request-preview');
    pre.classList.remove('hidden');
    pre.textContent = JSON.stringify(body, null, 2);
    msgEl.textContent = `compiled: ${body.characters.length} character block(s), no flattened prompt`;
    return;
  }
  const message = ok
    ? JSON.stringify(body)
    : `${status}: ${body.error ?? 'error'}${body.reasons ? ' - ' + body.reasons.join('; ') : ''}${body.details ? ' - ' + body.details.join('; ') : ''}${body.note ? ' (' + body.note + ')' : ''}${body.how ? ' (' + body.how + ')' : ''}`;
  // Re-render to reflect new status, then restore the message on the fresh card
  await loadScenes(false);
  const card = document.querySelector(`.scene-card[data-scene-id="${sceneId}"] .scene-msg`);
  if (card) card.textContent = message;
}

async function loadScenes(clearPreview = true) {
  if (clearPreview) $('scene-request-preview').classList.add('hidden');
  const { ok, body } = await api('/api/scenes');
  const el = $('scene-list');
  if (!ok) { el.textContent = 'failed to load scenes'; return; }
  if (!body.length) { el.textContent = 'no scenes yet'; return; }
  el.innerHTML = '';
  for (const s of body) {
    const names = s.characters.map((c) => {
      const cat = characterCatalog.find((x) => x.id === c.characterId);
      return `${cat ? esc(cat.record.identity.name) : c.characterId} v${c.characterVersion}`;
    }).join(' + ');
    const card = document.createElement('div');
    card.className = 'scene-card';
    card.dataset.sceneId = s.id;
    card.innerHTML = `
      <span class="status ${esc(s.validationStatus)}">${esc(s.validationStatus)}</span>
      <span>${names}</span>
      <span style="color:var(--dim)">${esc(s.setting?.location ?? '')}</span>
      <button data-a="compile">Compile</button>
      <button data-a="generate">Generate</button>
      <button data-a="validate">Validate</button>
      <button data-a="publish">Publish</button>
      <span class="scene-msg">gen: ${esc(s.generation.status)}${s.generation.lastOutput ? ' | output: ' + esc(s.generation.lastOutput.provider) : ''}</span>`;
    const msgEl = card.querySelector('.scene-msg');
    for (const btn of card.querySelectorAll('button')) {
      btn.addEventListener('click', () => sceneAction(s.id, btn.dataset.a, msgEl));
    }
    el.appendChild(card);
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
  await Promise.all([loadProfile(), loadHistory(), loadMemories(), loadGallery(), loadSceneCharacters(), loadScenes()]);
}

$('chat-form').addEventListener('submit', sendChat);
$('image-form').addEventListener('submit', sendImage);
$('scene-create').addEventListener('click', createScene);
if (initAgeGate()) boot();
