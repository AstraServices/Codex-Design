// Shared studio shell: top navigation (Workshop · Texture Studio · VFX Studio · GFX Studio) and the Settings dialog
// (Roblox Open Cloud key, creator, upload behaviour, studio defaults). Used by index.html, texture.html and vfx.html.
// The API key is write-only: the server keeps it in codex.settings.json and only returns a masked hint.

const PAGES = [['/', 'WORKSHOP'], ['/texture', 'TEXTURE STUDIO'], ['/vfx', 'VFX STUDIO'], ['/?gfx=1', 'GFX STUDIO']];
let cache = null;
export async function getSettings(force) { if (!cache || force) cache = await (await fetch('/api/settings')).json(); return cache; }
export async function saveSettings(patch) {
  const r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  const body = await r.json(); if (!r.ok) throw new Error(body.error || 'Saving settings failed'); cache = body; return body;
}

export function toast(text, { error = false, ms = 4200 } = {}) {
  const el = document.createElement('div'); el.className = 'toast' + (error ? ' err' : ''); el.textContent = text; el.setAttribute('role', error ? 'alert' : 'status');
  document.body.append(el); setTimeout(() => el.remove(), ms);
}

/** Adds the studio nav and ⚙ Settings button into the existing <header>. */
export function mountShell({ current } = {}) {
  const header = document.querySelector('header'); if (!header || header.querySelector('.studio-nav')) return;
  const nav = document.createElement('nav'); nav.className = 'studio-nav'; nav.setAttribute('aria-label', 'Studios');
  for (const [href, label] of PAGES) { const a = document.createElement('a'); a.href = href; a.textContent = label; if (label === current) a.setAttribute('aria-current', 'page'); nav.append(a); }
  header.querySelector('.brand')?.after(nav);
  const center = header.querySelector('.header-center'); if (center && current !== 'WORKSHOP') center.remove();
  const gear = document.createElement('button'); gear.id = 'settings-open'; gear.title = 'Settings (,)'; gear.textContent = '⚙'; gear.setAttribute('aria-label', 'Settings');
  header.append(gear); gear.onclick = () => openSettings();
  addEventListener('keydown', e => { if (e.key === ',' && !e.target.closest('input,textarea,select')) openSettings(); });
}

const TABS = [['roblox', 'Roblox'], ['general', 'General'], ['texture', 'Texture Studio'], ['vfx', 'VFX Studio'], ['gfx', 'GFX Studio']];
function dialog() {
  let d = document.getElementById('settings-dialog'); if (d) return d;
  d = document.createElement('dialog'); d.id = 'settings-dialog'; d.className = 'dialog';
  d.innerHTML = `<form method="dialog"><div class="section-label">SETTINGS <span>SAVED LOCALLY · codex.settings.json</span></div>
  <div class="tabs" role="tablist">${TABS.map(([id, l], i) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${i === 0}">${l}</button>`).join('')}</div>
  <div class="pane" data-pane="roblox">
    <p class="fine">Roblox Creator Dashboard → <b>Credentials</b> → Create API key with <b>asset:read</b> + <b>asset:write</b> (and your IP or 0.0.0.0/0). The key stays on this computer; the page can only replace or clear it.</p>
    <label class="field">Open Cloud API key<span class="keybox"><input id="st-key" type="password" autocomplete="off" placeholder="Paste a new key to replace the saved one"><button type="button" id="st-key-show">Show</button></span><small id="st-key-hint" class="fine"></small></label>
    <div class="row"><button type="button" id="st-key-test">Test key</button><button type="button" id="st-key-clear">Remove key</button><span id="st-key-result" class="fine grow"></span></div>
    <label class="field">Creator<span class="pair"><select id="st-creatorType"><option value="user">User</option><option value="group">Group</option></select><input id="st-creatorId" inputmode="numeric" placeholder="User or group ID"></span></label>
    <label class="field">Image uploads as<select id="st-uploadAssetType"><option value="Decal">Decal (Open Cloud image upload)</option></select></label>
    <label class="field check"><input type="checkbox" id="st-resolveImageIds"> Resolve decal → image ids automatically (falls back to the Studio importer)</label>
    <label class="field check"><input type="checkbox" id="st-askBeforeUpload"> Always ask before uploading to Roblox</label>
    <p class="fine">AI import rule: without a Studio MCP connection the AI asks “Roblox Studio bağlantısı göremedim, doğrudan Roblox'a yükleyip ID'leri atayayım mı?”; with a connection it asks before uploading and inserting into the open place.</p>
  </div>
  <div class="pane" data-pane="general" hidden>
    <label class="field">Language for AI answers<select id="st-language"><option value="tr">Türkçe</option><option value="en">English</option></select></label>
    <label class="field">Default GLB/glTF target<select id="st-exportTarget"><option value="roblox">Roblox Studio</option><option value="generic">General glTF engines</option></select></label>
    <label class="field check"><input type="checkbox" id="st-checkUpdates"> Check GitHub for updates (custom builds: keep off to protect local changes)</label>
  </div>
  <div class="pane" data-pane="texture" hidden>
    <label class="field">Live preview resolution<select id="st-previewSize"><option>128</option><option>256</option><option>512</option></select></label>
    <label class="field">Default export resolution<select id="st-exportSize"><option>256</option><option>512</option><option>1024</option><option>2048</option><option>4096</option></select></label>
    <label class="field">Normal map format for generic exports<select id="st-normalFormat"><option value="opengl">OpenGL (+Y: Roblox, glTF, Unity, Godot, Blender)</option><option value="directx">DirectX (−Y: Unreal)</option></select></label>
    <label class="field check"><input type="checkbox" id="st-seamlessCheck"> Validate seamless tiling on every change</label>
    <label class="field check"><input type="checkbox" id="st-gpu"> Use the GPU for GLSL nodes</label>
  </div>
  <div class="pane" data-pane="vfx" hidden>
    <label class="field">Default quality<select id="st-quality"><option>Auto</option><option>High</option><option>Medium</option><option>Low</option></select></label>
    <label class="field">Particle budget (PC)<input id="st-maxParticles" type="number" min="50" max="2000"></label>
    <label class="field">Cull distance (studs)<input id="st-cullDistance" type="number" min="50" max="2000"></label>
    <label class="field check"><input type="checkbox" id="st-mobileBudget"> Warn about mobile budgets</label>
    <label class="field check"><input type="checkbox" id="st-preferLibrary"> AI searches the local VFX library before drawing its own</label>
  </div>
  <div class="pane" data-pane="gfx" hidden>
    <label class="field">Long titles<select id="st-titleFit"><option value="auto">Auto fit (shrink, then wrap to 2 lines)</option><option value="shrink">Shrink only</option><option value="wrap">Wrap only</option><option value="off">Off (fixed size)</option></select></label>
    <label class="field">Title size <output id="st-titleScale-v"></output><input id="st-titleScale" type="range" min="0.5" max="1.6" step="0.05"></label>
    <label class="field check"><input type="checkbox" id="st-autoShowcase"> Offer automatic showcase (beauty + wireframe + topology) after a model is finished</label>
  </div>
  <div class="actions"><span id="st-status" class="fine grow"></span><button value="cancel">Close</button><button type="button" id="st-save" class="primary">Save settings</button></div></form>`;
  document.body.append(d);
  const $ = id => d.querySelector('#' + id);
  d.querySelectorAll('[role=tab]').forEach(b => b.onclick = () => { d.querySelectorAll('[role=tab]').forEach(x => x.setAttribute('aria-selected', x === b)); d.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; }); });
  $('st-key-show').onclick = () => { $('st-key').type = $('st-key').type === 'password' ? 'text' : 'password'; };
  $('st-titleScale').oninput = () => { $('st-titleScale-v').textContent = $('st-titleScale').value + '×'; };
  $('st-key-test').onclick = async () => {
    $('st-key-result').textContent = 'Checking…';
    if ($('st-key').value.trim()) await save();
    const r = await (await fetch('/api/roblox/test', { method: 'POST' })).json();
    $('st-key-result').textContent = r.ok ? `✓ ${r.name ?? 'Key'} · ${r.canUpload ? 'can upload assets' : 'missing asset:write'} · ${r.scopes.join(' ')}` : `✕ ${r.error}`;
  };
  $('st-key-clear').onclick = async () => { if (!confirm('Remove the saved Roblox API key from this computer?')) return; await saveSettings({ roblox: { clearApiKey: true } }); fill(await getSettings()); };
  const FIELDS = { roblox: ['creatorType', 'creatorId', 'uploadAssetType', 'resolveImageIds', 'askBeforeUpload'], general: ['language', 'exportTarget', 'checkUpdates'], texture: ['previewSize', 'exportSize', 'normalFormat', 'seamlessCheck', 'gpu'], vfx: ['quality', 'maxParticles', 'cullDistance', 'mobileBudget', 'preferLibrary'], gfx: ['titleFit', 'titleScale', 'autoShowcase'] };
  function fill(s) {
    for (const [group, keys] of Object.entries(FIELDS)) for (const k of keys) { const el = $('st-' + k), v = s[group]?.[k]; if (!el) continue; if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? ''; }
    $('st-key').value = ''; $('st-key-hint').textContent = s.roblox.apiKeySet ? `Saved key ${s.roblox.apiKeyHint}` : 'No key saved yet'; $('st-titleScale').oninput();
  }
  const NUM = new Set(['maxParticles', 'cullDistance', 'titleScale', 'previewSize', 'exportSize']);
  async function save() {
    const patch = {};
    for (const [group, keys] of Object.entries(FIELDS)) { patch[group] = {}; for (const k of keys) { const el = $('st-' + k); if (!el) continue; patch[group][k] = el.type === 'checkbox' ? el.checked : NUM.has(k) ? +el.value : el.value; } }
    if ($('st-key').value.trim()) patch.roblox.apiKey = $('st-key').value.trim();
    const s = await saveSettings(patch); fill(s); $('st-status').textContent = 'Saved ✓'; setTimeout(() => { $('st-status').textContent = ''; }, 2500);
    dispatchEvent(new CustomEvent('codex-settings', { detail: s }));
  }
  $('st-save').onclick = () => save().catch(e => { $('st-status').textContent = e.message; });
  d.fill = fill;
  return d;
}
export async function openSettings(tab) {
  const d = dialog(); d.fill(await getSettings(true));
  if (tab) d.querySelector(`[data-tab="${tab}"]`)?.click();
  d.showModal();
}

/** Upload helper with the mandatory confirmation. files: [{path|base64,fileName,name}] → [{key,assetId,imageId,…}] */
export async function uploadToRoblox(files, { reason = 'these files' } = {}) {
  const s = await getSettings(true);
  if (!s.roblox.apiKeySet || !s.roblox.creatorId) { toast('Add your Roblox API key and creator ID first (Settings → Roblox).', { error: true }); await openSettings('roblox'); return null; }
  if (s.roblox.askBeforeUpload !== false && !confirm(`Upload ${files.length} file(s) to your Roblox account (${s.roblox.creatorType} ${s.roblox.creatorId}) for ${reason}?\n\nThey become Roblox assets (Decal/Model) on your account.`)) return null;
  const out = [];
  for (const f of files) {
    const r = await fetch('/api/roblox/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const body = await r.json(); if (!r.ok) throw new Error(`${f.name ?? f.path}: ${body.error}`); out.push({ key: f.key ?? f.path, ...body });
  }
  return out;
}
