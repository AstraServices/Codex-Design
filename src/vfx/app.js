// VFX Studio page: effect list, imported VFX library, AI fallback art, layer editor, Roblox validator, asset ids,
// Open Cloud upload and Roblox package export (.rbxm + .rbxmx + Luau controller + importer + textures + manifest).
// window.codexVFX exposes the same actions for agents (load, validate, exportPackage, snapshot).
import { zipSync, strToU8 } from 'fflate';
import { mountShell, toast, uploadToRoblox, getSettings } from '../studio/shell.js';
import { VFXPreview } from './preview.js';
import { generate, KINDS, canvasToBase64, specName } from './texgen.js';
import { buildEffect, buildPackage, validateEffect, textureRefs, textureKey, safeName, DEFAULTS } from '../rbx/vfx-build.js';
import { toRBXM } from '../rbx/rbxm.js';
import { toRBXMX } from '../rbx/rbxmx.js';
import { generateLuau } from '../rbx/vfx-luau.js';
import { saveSettings } from '../studio/shell.js';

mountShell({ current: 'VFX STUDIO' });
const $ = id => document.getElementById(id);
const status = t => { $('status').textContent = t; };
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { console.error(e); toast(e.message, { error: true, ms: 7000 }); status(e.message); } };
const json = async (url, opt) => { const r = await fetch(url, opt); const b = await r.json(); if (!r.ok) throw new Error(b.error || r.statusText); return b; };

let effects = [], current = null, effectId = null, dirty = false, library = { effects: [], particles: [] }, assets = {}, pickTextureFor = null, tag = '';
const preview = new VFXPreview($('viewport'));
const controller = fetch('/src/rbx/vfx-controller.luau').then(r => r.text()), importer = fetch('/src/rbx/vfx-importer.luau').then(r => r.text());
const urlOf = tex => tex?.src ? '/' + tex.src.replace(/^\/+/, '') : null;

// ---------- schema for the layer editor (only real Roblox properties) ----------
const EN = { Orientation: ['FacingCamera', 'FacingCameraWorldUp', 'VelocityParallel', 'VelocityPerpendicular'], EmissionDirection: ['Top', 'Bottom', 'Front', 'Back', 'Right', 'Left'],
  FlipbookLayout: ['None', 'Grid2x2', 'Grid4x4', 'Grid8x8', 'Custom'], FlipbookMode: ['Loop', 'OneShot', 'PingPong', 'Random'], TextureMode: ['Stretch', 'Wrap', 'Static'], Face: ['Front', 'Back', 'Top', 'Bottom', 'Left', 'Right'], DepthMode: ['Occluded', 'AlwaysOnTop'],
  Shape: ['Box', 'Sphere', 'Cylinder', 'Disc'], ShapeStyle: ['Volume', 'Surface'], ShapeInOut: ['Outward', 'Inward', 'InAndOut'] };
const F = {
  emitter: [['Rate', 'num'], ['Lifetime', 'range'], ['Speed', 'range'], ['SpreadAngle', 'vec2'], ['Size', 'seq'], ['Transparency', 'seq'], ['Color', 'cseq'], ['LightEmission', 'unit'], ['LightInfluence', 'unit'], ['Brightness', 'num'],
    ['Drag', 'num'], ['Acceleration', 'vec3'], ['Rotation', 'range'], ['RotSpeed', 'range'], ['Orientation', 'enum'], ['EmissionDirection', 'enum'], ['Squash', 'seq'], ['ZOffset', 'num'], ['VelocityInheritance', 'num'], ['LockedToPart', 'bool'],
    ['TimeScale', 'unit'], ['FlipbookLayout', 'enum'], ['FlipbookMode', 'enum'], ['FlipbookFramerate', 'range'], ['FlipbookStartRandom', 'bool'], ['FlipbookSizeX', 'int'], ['FlipbookSizeY', 'int']],
  beam: [['Width0', 'num'], ['Width1', 'num'], ['CurveSize0', 'num'], ['CurveSize1', 'num'], ['Segments', 'int'], ['Color', 'cseq'], ['Transparency', 'seq'], ['LightEmission', 'unit'], ['LightInfluence', 'unit'], ['Brightness', 'num'], ['TextureLength', 'num'], ['TextureMode', 'enum'], ['TextureSpeed', 'num'], ['FaceCamera', 'bool'], ['ZOffset', 'num']],
  trail: [['Lifetime', 'num'], ['MinLength', 'num'], ['MaxLength', 'num'], ['WidthScale', 'seq'], ['Color', 'cseq'], ['Transparency', 'seq'], ['LightEmission', 'unit'], ['LightInfluence', 'unit'], ['Brightness', 'num'], ['TextureLength', 'num'], ['TextureMode', 'enum'], ['FaceCamera', 'bool']],
  light: [['Brightness', 'num'], ['Range', 'num'], ['Color', 'color'], ['Shadows', 'bool'], ['Angle', 'num'], ['Face', 'enum']],
  highlight: [['FillColor', 'color'], ['FillTransparency', 'unit'], ['OutlineColor', 'color'], ['OutlineTransparency', 'unit'], ['DepthMode', 'enum']],
  post: { BloomEffect: [['Intensity', 'num'], ['Size', 'num'], ['Threshold', 'num']], ColorCorrectionEffect: [['Brightness', 'num'], ['Contrast', 'num'], ['Saturation', 'num'], ['TintColor', 'color']], BlurEffect: [['Size', 'num']], DepthOfFieldEffect: [['FarIntensity', 'unit'], ['FocusDistance', 'num'], ['InFocusRadius', 'num'], ['NearIntensity', 'unit']] },
};
const NEW = {
  emitter: () => ({ type: 'emitter', name: 'Sparks', props: { Lifetime: [0.4, 0.8], Speed: [12, 20], SpreadAngle: [60, 60], Size: [[0, 0.6], [1, 0]], Transparency: [[0, 0], [1, 1]], Color: '#ffd27a', LightEmission: 1, LightInfluence: 0, Drag: 3 }, emit: { mode: 'burst', bursts: [{ t: 0, count: 24 }] } }),
  beam: () => ({ type: 'beam', name: 'Beam', props: { Width0: 1.5, Width1: 0.2, CurveSize0: 2, Color: '#9fd8ff', Transparency: [[0, 0], [1, 0.6]], LightEmission: 1, TextureMode: 'Wrap', TextureSpeed: 2 }, a0: [0, 0, 0], a1: [0, 8, 0], duration: 1 }),
  trail: () => ({ type: 'trail', name: 'Trail', props: { Lifetime: 0.35, WidthScale: [[0, 1], [1, 0]], Color: '#ffffff', Transparency: [[0, 0.2], [1, 1]], LightEmission: 1, FaceCamera: true }, a0: [0, -0.5, 0], a1: [0, 0.5, 0], duration: 2 }),
  light: () => ({ type: 'light', name: 'Light', class: 'PointLight', props: { Brightness: 4, Range: 16, Color: '#ffcf8a' }, duration: 0.6, anim: [{ prop: 'Brightness', from: 4, to: 0, time: 0.6 }] }),
  mesh: () => ({ type: 'mesh', name: 'Shockwave', shape: 'Ball', material: 'ForceField', color: '#8fdcff', size: [1, 1, 1], transparency: 0, anim: [{ prop: 'Size', from: [1, 1, 1], to: [16, 16, 16], time: 0.4, style: 'Quint', dir: 'Out' }, { prop: 'Transparency', from: 0, to: 1, time: 0.45, style: 'Quad', dir: 'In' }] }),
  highlight: () => ({ type: 'highlight', name: 'Flash', props: { FillColor: '#ffffff', FillTransparency: 0.4, OutlineTransparency: 0 }, duration: 0.2 }),
  post: () => ({ type: 'post', name: 'Bloom', class: 'BloomEffect', props: { Intensity: 1.5, Size: 24, Threshold: 1.5 }, duration: 0.3 }),
};

// ---------- value <-> text ----------
const fmtSeq = v => typeof v === 'number' ? String(v) : Array.isArray(v) ? v.map(k => k.slice(0, k[2] ? 3 : 2).join(':')).join(', ') : '';
const parseSeq = s => { s = s.trim(); if (/^-?[\d.]+$/.test(s)) return +s; return s.split(',').map(p => p.trim().split(':').map(Number)).filter(k => k.length >= 2 && k.every(Number.isFinite)); };
const fmtCseq = v => typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] !== 'number' ? v.map(([t, c]) => `${t}:${c}`).join(', ') : '';
const parseCseq = s => { s = s.trim(); if (/^#[0-9a-f]{6}$/i.test(s)) return s; return s.split(',').map(p => { const [t, c] = p.trim().split(':'); return [+t, c?.trim()]; }).filter(([t, c]) => Number.isFinite(t) && /^#[0-9a-f]{6}$/i.test(c ?? '')); };
const cssGradient = v => { const s = typeof v === 'string' ? [[0, v], [1, v]] : v; return `linear-gradient(90deg,${s.map(([t, c]) => `${c} ${t * 100}%`).join(',')})`; };

function field(label, el, hint) { const l = document.createElement('label'); l.className = 'field'; l.append(label); if (hint) { const o = document.createElement('output'); o.textContent = hint; l.append(o); } l.append(el); return l; }
function input(type, value, on, attrs = {}) { const i = document.createElement('input'); i.type = type; if (type === 'checkbox') i.checked = !!value; else i.value = value ?? ''; Object.assign(i, attrs); i.addEventListener(type === 'checkbox' || type === 'color' ? 'change' : 'change', () => on(type === 'checkbox' ? i.checked : type === 'number' || type === 'range' ? +i.value : i.value)); return i; }
function select(options, value, on) { const s = document.createElement('select'); for (const o of options) { const op = document.createElement('option'); op.value = op.textContent = o; s.append(op); } s.value = value ?? options[0]; s.onchange = () => on(s.value); return s; }
function multi(n, value, on, step = 0.1) { const w = document.createElement('div'); w.className = n === 3 ? 'triple' : 'pair'; const v = Array.isArray(value) ? [...value] : Array(n).fill(value ?? 0); for (let i = 0; i < n; i++) w.append(input('number', v[i] ?? v[0] ?? 0, x => { v[i] = x; on([...v]); }, { step })); return w; }

function propEditor(L, cls, key, kind) {
  const P = L.props ??= {}, def = DEFAULTS[cls]?.[key], val = P[key] ?? def, set = v => { P[key] = v; changed(); };
  switch (kind) {
    case 'num': return field(key, input('number', val, set, { step: 0.1 }));
    case 'int': return field(key, input('number', val ?? 4, v => set(Math.round(v)), { step: 1, min: 1 }));
    case 'unit': { const o = document.createElement('output'); const f = field(key, input('range', val, v => { o.textContent = v; set(v); }, { min: 0, max: 1, step: 0.05 })); o.textContent = val; f.querySelector('input').before(o); return f; }
    case 'bool': { const l = field('', input('checkbox', val, set)); l.classList.add('check'); l.append(key); return l; }
    case 'enum': return field(key, select(EN[key], val, set));
    case 'range': return field(key + ' (min, max)', multi(2, Array.isArray(val) ? val : [val, val], set));
    case 'vec2': return field(key + ' (x, y)', multi(2, val, set, 1));
    case 'vec3': return field(key + ' (x, y, z)', multi(3, val, set));
    case 'color': return field(key, input('color', val ?? '#ffffff', set));
    case 'seq': { const i = input('text', fmtSeq(val), v => set(parseSeq(v)), { placeholder: 'time:value[:envelope], …  or one number' }); return field(key, i); }
    case 'cseq': { const i = input('text', fmtCseq(val), v => { const p = parseCseq(v); if (p.length || typeof p === 'string') set(p); }, { placeholder: '#hex  or  0:#ffffff, 1:#5cc8ff' }); const bar = document.createElement('div'); bar.style.cssText = `height:6px;border-radius:3px;margin-top:3px;background:${cssGradient(typeof val === 'string' ? val : val ?? '#ffffff')}`; const f = field(key, i); f.append(bar); return f; }
  }
}

function layerEditor(L, index) {
  const d = document.createElement('details'); d.className = 'layer'; d.open = index === openLayer;
  d.ontoggle = () => { if (d.open) openLayer = index; };
  const s = document.createElement('summary'); s.innerHTML = `<span class="kind">${L.type.toUpperCase()}</span><b></b>`; s.querySelector('b').textContent = L.name ?? L.type;
  const en = input('checkbox', L.enabled !== false, v => { L.enabled = v; changed(); }); en.title = 'Layer enabled'; en.onclick = e => e.stopPropagation(); s.append(en); d.append(s);
  const b = document.createElement('div'); b.className = 'body'; d.append(b);
  b.append(field('Name', input('text', L.name ?? '', v => { L.name = safeName(v); changed(true); })));
  b.append(field('Delay (s)', input('number', L.delay ?? 0, v => { L.delay = v; changed(); }, { step: 0.05, min: 0 })));
  if (['emitter', 'beam', 'trail', 'mesh'].includes(L.type)) {
    const t = document.createElement('div'); t.className = 'row'; const thumb = document.createElement('img'); thumb.style.cssText = 'width:42px;height:42px;object-fit:contain;border-radius:4px;background:#111'; if (urlOf(L.texture)) thumb.src = urlOf(L.texture);
    const info = document.createElement('span'); info.className = 'fine grow'; info.textContent = L.texture ? (L.texture.assetId ? `rbxassetid://${L.texture.assetId}` : textureKey(L.texture)) : 'No texture';
    const pick = document.createElement('button'); pick.type = 'button'; pick.textContent = pickTextureFor === L ? 'Click a library tile…' : 'Pick from library'; pick.onclick = () => { pickTextureFor = pickTextureFor === L ? null : L; renderLayers(); toast(pickTextureFor ? 'Now click a tile in the VFX library (left) to use it as this layer\'s texture.' : 'Texture pick cancelled'); };
    t.append(thumb, info, pick); b.append(field('Texture', t));
  }
  const cls = { emitter: 'ParticleEmitter', beam: 'Beam', trail: 'Trail', light: L.class ?? 'PointLight', highlight: 'Highlight', post: L.class ?? 'BloomEffect' }[L.type];
  if (L.type === 'light') b.append(field('Class', select(['PointLight', 'SpotLight', 'SurfaceLight'], L.class ?? 'PointLight', v => { L.class = v; changed(true); })));
  if (L.type === 'post') b.append(field('Class', select(Object.keys(F.post), L.class ?? 'BloomEffect', v => { L.class = v; L.props = {}; changed(true); })));
  if (L.type === 'mesh') {
    b.append(field('Shape (Part)', select(['Ball', 'Cylinder', 'Block'], L.shape ?? 'Ball', v => { L.shape = v; changed(); })));
    b.append(field('Material', select(['Neon', 'ForceField', 'Glass', 'SmoothPlastic'], L.material ?? 'Neon', v => { L.material = v; changed(); })));
    b.append(field('Color', input('color', L.color ?? '#ffffff', v => { L.color = v; changed(); })));
    b.append(field('Size (studs)', multi(3, L.size ?? [1, 1, 1], v => { L.size = v; changed(); })));
    b.append(field('Start transparency', input('number', L.transparency ?? 1, v => { L.transparency = v; changed(); }, { step: 0.05, min: 0, max: 1 })));
    b.append(field('Mesh id (optional, uploaded mesh)', input('text', L.meshId ?? '', v => { L.meshId = v || undefined; changed(); }, { placeholder: 'rbxassetid / number' })));
  }
  const list = L.type === 'post' ? F.post[L.class ?? 'BloomEffect'] : F[L.type];
  for (const [k, kind] of list ?? []) { if ((k === 'FlipbookSizeX' || k === 'FlipbookSizeY') && L.props?.FlipbookLayout !== 'Custom') continue; b.append(propEditor(L, cls, k, kind)); }
  if (L.type === 'emitter') {
    L.emit ??= { mode: 'burst', bursts: [{ t: 0, count: 20 }] };
    b.append(field('Emission', select(['burst', 'continuous'], L.emit.mode, v => { L.emit.mode = v; changed(true); })));
    if (L.emit.mode === 'burst') b.append(field('Bursts (time:count, …)', input('text', (L.emit.bursts ?? []).map(x => `${x.t ?? 0}:${x.count ?? 20}`).join(', '), v => { L.emit.bursts = v.split(',').map(p => p.trim().split(':').map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite)).map(([t, count]) => ({ t, count })); changed(); })));
    else b.append(field('Emit for (s) at Rate/s', input('number', L.emit.duration ?? 1, v => { L.emit.duration = v; changed(); }, { step: 0.1, min: 0.05 })));
  }
  if (['emitter', 'light', 'mesh'].includes(L.type)) b.append(field('Offset (studs)', multi(3, L.offset ?? [0, 0, 0], v => { L.offset = v; changed(); })));
  if (L.type === 'beam' || L.type === 'trail') { b.append(field('Attachment0', multi(3, L.a0 ?? [0, 0, 0], v => { L.a0 = v; changed(); }))); b.append(field('Attachment1', multi(3, L.a1 ?? [0, 4, 0], v => { L.a1 = v; changed(); }))); }
  if (L.type !== 'mesh' && L.type !== 'emitter') b.append(field('Active for (s)', input('number', L.duration ?? 1, v => { L.duration = v; changed(); }, { step: 0.05, min: 0.01 })));
  const anim = document.createElement('textarea'); anim.className = 'code'; anim.rows = 3; anim.value = JSON.stringify(L.anim ?? []);
  anim.onchange = () => { try { L.anim = JSON.parse(anim.value || '[]'); changed(); } catch { toast('Animation list must be JSON: [{"prop":"Size","from":[1,1,1],"to":[8,8,8],"time":0.4,"style":"Quint","dir":"Out"}]', { error: true }); } };
  b.append(field('Animations (TweenService easing; props: Size, Transparency, Color, Brightness, Range, Width0…)', anim));
  const tools = document.createElement('div'); tools.className = 'tools';
  for (const [label, fn] of [['↑', () => move(index, -1)], ['↓', () => move(index, 1)], ['Duplicate', () => { const c = structuredClone(L); c.name = safeName((L.name ?? L.type) + '2'); current.layers.splice(index + 1, 0, c); changed(true); }], ['Delete', () => { current.layers.splice(index, 1); changed(true); }]]) { const x = document.createElement('button'); x.type = 'button'; x.textContent = label; x.onclick = fn; tools.append(x); }
  b.append(tools); return d;
}
let openLayer = 0;
const move = (i, d) => { const j = i + d; if (j < 0 || j >= current.layers.length) return; [current.layers[i], current.layers[j]] = [current.layers[j], current.layers[i]]; openLayer = j; changed(true); };
function renderLayers() { const box = $('layers'); box.replaceChildren(...(current?.layers ?? []).map(layerEditor)); $('layer-count').textContent = current?.layers?.length ?? 0; }

// ---------- state ----------
let reloadTimer;
function changed(structure = false) {
  dirty = true; if (structure) renderLayers(); syncJSON(); validate();
  clearTimeout(reloadTimer); reloadTimer = setTimeout(() => reloadPreview(), 120); status('Unsaved changes');
}
function syncJSON() { $('json').value = JSON.stringify(current, null, 1); }
async function reloadPreview() { if (!current) return; const { events } = buildEffect(current, { assets: imageIds() }); await preview.load(current, events, urlOf); $('scrub').max = preview.duration; }
const imageIds = () => Object.fromEntries(Object.entries(assets).filter(([k]) => !k.startsWith('decal:')));
function validate() {
  if (!current) return [];
  const issues = validateEffect(current, { assets: imageIds(), mobile: true }), box = $('issues');
  const e = issues.filter(i => i.level === 'error').length, w = issues.filter(i => i.level === 'warn').length;
  $('val-summary').textContent = e ? `${e} ERROR${e > 1 ? 'S' : ''}` : w ? `${w} WARNING${w > 1 ? 'S' : ''}` : 'READY ✓';
  box.replaceChildren(...(issues.length ? issues : [{ level: 'ok', message: 'All Roblox checks passed.' }]).map(i => { const r = document.createElement('div'); r.className = 'issue'; r.innerHTML = `<span class="badge ${{ error: 'err', warn: 'warn', info: 'info' }[i.level] ?? ''}">${i.level.toUpperCase()}</span><span></span>`; r.lastChild.textContent = (i.layer ? `${i.layer}: ` : '') + i.message; return r; }));
  renderIds(); return issues;
}
function renderIds() {
  const refs = current ? textureRefs(current) : [], box = $('ids'); let ok = 0;
  box.replaceChildren(...refs.map(r => { const id = assets[r.key], decal = assets['decal:' + r.key]; if (id) ok++; const row = document.createElement('div'); row.className = 'issue';
    row.innerHTML = `<span class="badge ${id ? '' : decal ? 'warn' : 'err'}">${id ? 'IMAGE' : decal ? 'DECAL' : 'NONE'}</span><span></span>`; row.lastChild.textContent = `${r.layer}: ${r.key}${id ? ` → ${id}` : decal ? ` → decal ${decal} (Studio importer resolves)` : ''}`; return row; }));
  if (!refs.length) box.textContent = 'This effect uses no local textures.';
  $('ids-summary').textContent = `${ok}/${refs.length}`;
}

async function refreshList() {
  effects = await json('/api/vfx'); $('fx-count').textContent = effects.length;
  $('fx-list').replaceChildren(...effects.map(e => { const b = document.createElement('button'); b.className = 'list-item' + (e.id === effectId ? ' active' : ''); b.innerHTML = '<span>✦</span><span><b></b><small></small></span>'; b.querySelector('b').textContent = e.name; b.querySelector('small').textContent = e.description?.slice(0, 60) || e.id; b.onclick = guard(() => open(e.id)); return b; }));
}
async function open(id, { keepView } = {}) {
  if (dirty && id !== effectId && !confirm('Discard unsaved changes?')) return;
  current = await json('/api/vfx/' + id); effectId = id; dirty = false; current.layers ??= [];
  $('fx-title').textContent = current.name; $('fx-id').textContent = `vfx/${id}.vfx.json`; $('fx-name').value = current.name ?? ''; $('fx-desc').value = current.description ?? ''; $('fx-duration').value = current.duration ?? ''; $('fx-loop').checked = !!current.loop;
  history.replaceState(null, '', `?effect=${id}`); renderLayers(); syncJSON(); validate(); await reloadPreview(); await refreshList(); status(`Loaded ${current.name}`);
}
async function save() {
  if (!current) return; const id = effectId ?? slug(current.name);
  await json('/api/vfx/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current) }); effectId = id; dirty = false; await refreshList(); status(`Saved vfx/${id}.vfx.json`); toast('Saved ✓');
}
const slug = s => String(s).replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'fx-$1').slice(0, 60) || 'effect';

// ---------- library ----------
async function loadLibrary() {
  try { library = await json('/assets/vfx/library.json'); } catch { library = { effects: [], particles: [] }; }
  const tags = [...new Set([...library.effects, ...library.particles].flatMap(e => e.tags))].sort();
  $('lib-tags').replaceChildren(...['all', ...tags].map(t => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.setAttribute('aria-pressed', (t === 'all' ? '' : t) === tag); b.onclick = () => { tag = t === 'all' ? '' : t; loadLibraryView(); $('lib-tags').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); }; return b; }));
  loadLibraryView();
}
function loadLibraryView() {
  const q = $('lib-search').value.trim().toLowerCase(), list = ($('lib-particles').checked ? library.particles : library.effects).filter(e => (!tag || e.tags.includes(tag)) && (!q || (e.name + ' ' + e.tags.join(' ') + ' ' + e.pack).toLowerCase().includes(q)));
  $('lib-count').textContent = `${list.length} / ${library.effects.length + library.particles.length}`;
  $('lib-grid').replaceChildren(...list.slice(0, 120).map(e => {
    const t = document.createElement('button'); t.className = 'tile'; t.title = `${e.name}\n${e.license}${e.layout ? `\n${e.layout} · ${e.sourceFrames} source frames` : ''}`;
    const th = document.createElement('div'); th.className = 'thumb';
    if (e.kind === 'flipbook') { // light thumbnail; the full 1024 atlas animates only while hovered
      const i = document.createElement('img'); i.loading = 'lazy'; i.src = '/' + e.thumb; th.append(i);
      t.onmouseenter = () => { if (th.querySelector('.flip')) return; const f = document.createElement('div'); f.className = 'flip'; f.style.cssText = `position:absolute;inset:0;background-image:url(/${e.texture});background-size:${e.grid * 100}% ${e.grid * 100}%`; th.append(f); animateFlip(f, e.grid); };
      t.onmouseleave = () => th.querySelector('.flip')?.remove(); }
    else { const i = document.createElement('img'); i.loading = 'lazy'; i.src = '/' + e.texture; th.append(i); }
    const lic = /unknown/i.test(e.license) ? ' ⚠' : ''; t.innerHTML += ''; t.append(th); const b = document.createElement('b'); b.textContent = e.name + lic; const s = document.createElement('small'); s.textContent = `${e.pack} · ${e.layout ?? e.size?.join('×')}`; t.append(b, s);
    t.onclick = () => useLibrary(e); return t;
  }));
}
const flips = new Set(); function animateFlip(el, grid) { el.dataset.grid = grid; el.dataset.f = 0; flips.add(el); }
setInterval(() => { for (const el of flips) { if (!el.isConnected) { flips.delete(el); continue; } const g = +el.dataset.grid, f = (+el.dataset.f + 1) % (g * g); el.dataset.f = f; el.style.backgroundPosition = `${(f % g) / (g - 1) * 100}% ${Math.floor(f / g) / (g - 1) * 100}%`; } }, 70);
function useLibrary(e) {
  if (!current) newEffect();
  const tex = { src: e.texture, ...(e.grid ? { grid: e.grid } : {}), library: e.id };
  if (/unknown/i.test(e.license)) toast(`License of ${e.name} is unknown (${e.pack}). Fine for tests; verify before publishing.`, { ms: 6500 });
  if (pickTextureFor) { pickTextureFor.texture = tex; if (e.grid && pickTextureFor.type === 'emitter') Object.assign(pickTextureFor.props, { FlipbookLayout: e.layout, FlipbookMode: e.suggest?.mode ?? 'OneShot', FlipbookFramerate: [e.suggest?.flipbookFramerate ?? 16, e.suggest?.flipbookFramerate ?? 16] }); pickTextureFor = null; changed(true); return; }
  const s = e.suggest ?? {}, life = s.lifetime ?? 1, burst = (s.kind ?? 'burst') === 'burst' || s.mode === 'OneShot';
  const L = { type: 'emitter', name: uniqueName(safeName(e.name)), texture: tex, props: e.kind === 'flipbook'
    ? { Lifetime: [life, life], Speed: [0, 0], Size: [[0, 6], [1, 6]], Transparency: 0, Color: '#ffffff', LightEmission: s.lightEmission ?? 1, LightInfluence: s.lightInfluence ?? 0, Rotation: [0, 0], FlipbookLayout: e.layout, FlipbookMode: s.mode ?? 'OneShot', FlipbookFramerate: [s.flipbookFramerate ?? 16, s.flipbookFramerate ?? 16], Rate: burst ? 0 : 4, ZOffset: 0.5 }
    : { Lifetime: [0.4, 0.9], Speed: [6, 14], SpreadAngle: [180, 180], Size: [[0, 1.2], [1, 0]], Transparency: [[0, 0], [1, 1]], Color: '#ffffff', LightEmission: 1, LightInfluence: 0, Drag: 2, Rotation: [0, 360], RotSpeed: [-90, 90] },
    emit: burst ? { mode: 'burst', bursts: [{ t: 0, count: e.kind === 'flipbook' ? 1 : 20 }] } : { mode: 'continuous', duration: current.duration || 2 } };
  current.layers.push(L); openLayer = current.layers.length - 1; changed(true); toast(`Added ${e.name} as emitter "${L.name}"`);
}
const uniqueName = n => { let k = n, i = 2; const used = new Set(current.layers.map(l => l.name)); while (used.has(k)) k = n + i++; return k; };

// ---------- AI fallback art ----------
for (const [k, v] of Object.entries(KINDS)) { const o = document.createElement('option'); o.value = k; o.textContent = v.label + (v.flipbook ? ' (animated)' : ''); $('gen-kind').append(o); }
const genSpec = () => ({ kind: $('gen-kind').value, color: $('gen-color').value, grid: +$('gen-grid').value || 0, seed: +$('gen-seed').value || 1, softness: +$('gen-soft').value, size: 256, baked: KINDS[$('gen-kind').value].baked && $('gen-color').value.toLowerCase() === '#ffffff' });
function genPreview() { const c = generate({ ...genSpec(), grid: 0, size: 128 }), g = $('gen-preview').getContext('2d'); g.clearRect(0, 0, 128, 128); g.drawImage(c, 0, 0); $('gen-soft-v').textContent = $('gen-soft').value; }
for (const id of ['gen-kind', 'gen-color', 'gen-grid', 'gen-seed', 'gen-soft']) $(id).addEventListener('input', genPreview);
$('gen-add').onclick = guard(async () => {
  if (!current) newEffect(); const spec = genSpec(); if (spec.grid && !KINDS[spec.kind].flipbook) spec.grid = 0;
  const canvas = generate(spec), name = specName(spec), r = await json(`/api/studio-texture/vfx/${name}.png`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64: canvasToBase64(canvas) }) });
  const tex = { src: r.file, generated: spec, ...(spec.grid ? { grid: spec.grid } : {}) };
  if (pickTextureFor) { pickTextureFor.texture = tex; pickTextureFor = null; changed(true); return; }
  const L = NEW.emitter(); L.name = uniqueName(safeName(KINDS[spec.kind].label)); L.texture = tex;
  if (spec.grid) Object.assign(L.props, { FlipbookLayout: `Grid${spec.grid}x${spec.grid}`, FlipbookMode: 'OneShot', Size: [[0, 4], [1, 6]], Speed: [0, 1], Transparency: [[0, 0], [0.8, 0.2], [1, 1]], Lifetime: [0.8, 0.8] }), L.emit = { mode: 'burst', bursts: [{ t: 0, count: 1 }] };
  current.layers.push(L); openLayer = current.layers.length - 1; changed(true); toast(`Drew ${name}.png (vfx/textures) and added layer ${L.name}`);
});

// ---------- effect fields ----------
$('fx-name').onchange = () => { current.name = safeName($('fx-name').value); $('fx-name').value = current.name; $('fx-title').textContent = current.name; changed(); };
$('fx-desc').onchange = () => { current.description = $('fx-desc').value; changed(); };
$('fx-duration').onchange = () => { current.duration = +$('fx-duration').value || undefined; changed(); };
$('fx-loop').onchange = () => { current.loop = $('fx-loop').checked; changed(); };
$('add-layer').replaceChildren(...Object.keys(NEW).map(k => { const b = document.createElement('button'); b.type = 'button'; b.textContent = '＋ ' + k; b.onclick = () => { if (!current) newEffect(); const L = NEW[k](); L.name = uniqueName(L.name); current.layers.push(L); openLayer = current.layers.length - 1; changed(true); }; return b; }));
$('json-apply').onclick = guard(() => { const v = JSON.parse($('json').value); if (!Array.isArray(v.layers)) throw new Error('JSON needs a "layers" array'); current = v; changed(true); });
function newEffect() { current = { name: 'NewEffect', description: '', duration: 1, loop: false, layers: [] }; effectId = null; dirty = true; renderLayers(); syncJSON(); validate(); reloadPreview(); $('fx-title').textContent = current.name; $('fx-name').value = current.name; }
$('new-effect').onclick = () => { if (dirty && !confirm('Discard unsaved changes?')) return; newEffect(); const n = prompt('Effect name (used by VFX.Play)', 'NewEffect'); if (n) { current.name = safeName(n); $('fx-name').value = current.name; $('fx-title').textContent = current.name; syncJSON(); } };
$('save').onclick = guard(save); addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); guard(save)(); } if (e.key === 'r' && !e.target.closest('input,textarea,select')) preview.restart(); });

// ---------- playback ----------
$('play').onclick = () => { preview.playing = !preview.playing; $('play').textContent = preview.playing ? 'Ⅱ' : '▶'; };
$('restart').onclick = () => { preview.restart(); preview.playing = true; $('play').textContent = 'Ⅱ'; };
$('loop').onchange = () => { preview.loop = $('loop').checked; };
$('motion').onchange = () => { preview.motion = $('motion').checked; preview.restart(); };
$('dummy').onchange = () => { preview.dummy.visible = $('dummy').checked; };
$('speed').onchange = () => { preview.speed = +$('speed').value; };
$('quality').onchange = () => { preview.quality = +$('quality').value; preview.restart(); };
$('scale').onchange = () => { preview.scale = +$('scale').value || 1; preview.restart(); };
$('scrub').oninput = () => { preview.playing = false; $('play').textContent = '▶'; preview.seek(+$('scrub').value); };
preview.onFrame = p => { const s = p.stats(); if (p.playing) $('scrub').value = s.time; $('time').textContent = `${s.time.toFixed(2)} / ${(s.duration ?? 0).toFixed(2)} s`; $('hud').textContent = `${s.particles} particles · ${s.layers} layers · ${preview.quality < 1 ? 'quality ' + preview.quality : 'high'}`; };

// ---------- asset ids + upload ----------
async function loadIds() { assets = await json('/api/asset-ids'); }
async function uploadMissing(list = current ? [current] : []) {
  const need = [...new Map(list.flatMap(textureRefs).filter(r => !assets[r.key] && !assets['decal:' + r.key] && r.src).map(r => [r.key, r])).values()];
  if (!need.length) { toast('Every texture already has a Roblox id.'); return true; }
  const res = await uploadToRoblox(need.map(r => ({ path: r.src, key: r.key, name: `VFX ${r.key.split('/').slice(-2).join(' ').replace('.png', '')}` })), { reason: `the VFX effect "${current?.name}"` });
  if (!res) return false;
  const patch = {}; for (const r of res) { if (r.imageId) patch[r.key] = r.imageId; else patch['decal:' + r.key] = r.decalId; }
  assets = await json('/api/asset-ids', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  const decals = res.filter(r => !r.imageId).length; toast(`Uploaded ${res.length} texture(s).${decals ? ` ${decals} need the Studio importer to turn decal ids into image ids.` : ''}`, { ms: 7000 });
  validate(); return true;
}
$('upload').onclick = guard(() => uploadMissing());
$('ids-edit').onclick = guard(async () => {
  const refs = textureRefs(current ?? { layers: [] }); if (!refs.length) return toast('No textures in this effect.');
  const key = prompt('Texture path to assign an id to:\n' + refs.map(r => r.key).join('\n'), refs.find(r => !assets[r.key])?.key ?? refs[0].key); if (!key) return;
  const id = prompt('Roblox IMAGE id (not the decal id) for ' + key); if (!id) return;
  assets = await json('/api/asset-ids', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: id.replace(/\D/g, '') }) }); validate(); reloadPreview();
});

// ---------- export ----------
function luauFor(list, tex, ctrl) {
  const s = settingsCache?.vfx ?? {};
  return generateLuau(list, { controller: ctrl, quality: s.quality ?? 'Auto', cullDistance: s.cullDistance ?? 250,
    textures: tex.map(t => ({ key: `${t.effect}.${t.layer}`, imageId: t.imageId, decalId: t.decalId })) });
}
let settingsCache = null;
function texturePaths(effect) { // instance path inside VFXStudio for every textured layer (matches buildEffect naming)
  return (effect.layers ?? []).filter(L => L.enabled !== false && L.texture && !L.texture.assetId).map(L => { const n = safeName(L.name ?? L.type); return { effect: safeName(effect.name), layer: n, key: textureKey(L.texture), file: L.texture.src,
    path: `Effects/${safeName(effect.name)}/` + (L.type === 'emitter' ? `Root/${n}Att/${n}` : L.type === 'mesh' ? `${n}/Mesh` : `Root/${n}`) }; });
}
async function exportPackage({ all = false, placeholder = false, rbxm = true, rbxmx = true, luau = true, gen = true, textures = true, download = true } = {}) {
  const list = all ? await Promise.all(effects.map(e => json('/api/vfx/' + e.id))) : [current];
  if (!list.length || !list[0]) throw new Error('No effect to export');
  const ids = imageIds(), problems = list.flatMap(e => validateEffect(e, { assets: ids }).map(i => ({ ...i, effect: e.name })));
  // Missing ids never block the Luau generator (its CONFIG table is where ids go); they block .rbxm/.rbxmx unless placeholders are chosen.
  const blocking = problems.filter(i => i.level === 'error' && !((placeholder || (!rbxm && !rbxmx)) && i.code === 'missing-asset-id'));
  if (blocking.length) throw new Error(`Export blocked by ${blocking.length} Roblox error(s): ${blocking.slice(0, 3).map(i => `${i.effect}/${i.layer ?? ''} ${i.message}`).join(' · ')}`);
  const tex = list.flatMap(e => texturePaths(e).map(t => ({ ...t, imageId: ids[t.key] ?? null, decalId: assets['decal:' + t.key] ?? null })));
  const manifest = { textures: tex, exported: new Date().toISOString() };
  const pkg = buildPackage(list, { assets: ids, controller: await controller, manifest }), base = list.length > 1 ? 'CodexVFX' : safeName(list[0].name), files = {};
  if (rbxm) files[`${base}.rbxm`] = toRBXM(pkg);
  if (rbxmx) files[`${base}.rbxmx`] = strToU8(toRBXMX(pkg));
  if (gen) files[`${base}.luau`] = strToU8(luauFor(list, tex, await controller));
  if (luau) { files['VFXStudio.luau'] = strToU8(await controller); files['CodexVFX_Importer.luau'] = strToU8(await importer); }
  if (textures) { for (const t of tex) if (t.file && !files['textures/' + t.file.split('/').slice(-2).join('_')]) files['textures/' + t.file.split('/').slice(-2).join('_')] = new Uint8Array(await (await fetch('/' + t.file)).arrayBuffer()); for (const e of list) files[`${slug(e.name)}.vfx.json`] = strToU8(JSON.stringify(e, null, 1)); }
  files['manifest.json'] = strToU8(JSON.stringify({ ...manifest, effects: list.map(e => e.name), files: Object.keys(files) }, null, 1));
  files['README.txt'] = strToU8(`Codex Design VFX Studio export\n\n1. Drag ${base}.rbxm (or .rbxmx) into Roblox Studio and move the CodexVFX folder to ReplicatedStorage.\n2. ${tex.some(t => !t.imageId) ? 'Some textures have no image id yet: upload textures/*.png (Asset Manager → Bulk Import or Codex Design → Upload), then run CodexVFX_Importer.luau in the command bar.' : 'All textures already carry Roblox image ids.'}\n   OR (no file import): paste ${base}.luau into a ModuleScript named ${base} in ReplicatedStorage; its CONFIG table holds the texture ids.\n3. local VFX = require(game.ReplicatedStorage.CodexVFX.VFXStudio)  -- or require(game.ReplicatedStorage.${base})\n   VFX.Play("${list[0].name}", { Position = Vector3.new(0, 5, 0), Scale = 1, Quality = "Auto" })\n   Server: VFX.PlayForAll("${list[0].name}", { Position = … })  (clients must require the module once)\n\nAPI: Play, Stop, Pause, Resume, SetSpeed, SetScale, SetColor, Preload, Destroy, StopAll, PlayFor, PlayNear.\n`);
  const zip = zipSync(files, { level: 6 }), name = `${slug(base)}_CodexDesign.roblox-vfx.zip`;
  const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(new Blob([zip])); });
  const saved = await json(`/api/export-file/vfx/${name}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64: b64 }) });
  if (download) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  return { file: saved.file, bytes: zip.length, files: Object.keys(files), missing: tex.filter(t => !t.imageId).map(t => t.key), warnings: problems.filter(i => i.level === 'warn').length };
}
function refreshExportIssues() { const issues = validateEffect(current, { assets: imageIds() }); $('ex-issues').replaceChildren(...issues.filter(i => i.level !== 'info').map(i => { const r = document.createElement('div'); r.className = 'issue'; r.innerHTML = `<span class="badge ${i.level === 'error' ? 'err' : 'warn'}">${i.level.toUpperCase()}</span><span></span>`; r.lastChild.textContent = (i.layer ? i.layer + ': ' : '') + i.message; return r; })); if (!issues.some(i => i.level !== 'info')) $('ex-issues').textContent = 'All Roblox checks passed.'; }
$('export-open').onclick = guard(async () => { if (!current) return toast('Open or create an effect first.', { error: true }); $('ex-name').textContent = current.name; refreshExportIssues(); await keyState(); $('export-dialog').showModal(); });
const exOpts = () => ({ all: $('ex-all').checked, placeholder: $('ex-placeholder').checked, rbxm: $('ex-rbxm').checked, rbxmx: $('ex-rbxmx').checked, luau: $('ex-luau').checked, gen: $('ex-gen').checked, textures: $('ex-tex').checked });
async function keyState() { const s = settingsCache = await getSettings(true); $('ex-key-state').textContent = s.roblox.apiKeySet ? `KEY ${s.roblox.apiKeyHint}` : 'NO KEY'; $('ex-creatorType').value = s.roblox.creatorType; $('ex-creatorId').value = s.roblox.creatorId ?? ''; $('ex-key').value = ''; }
$('ex-oneclick').onclick = guard(async () => {
  const patch = { roblox: { creatorType: $('ex-creatorType').value, creatorId: $('ex-creatorId').value.trim() } }; if ($('ex-key').value.trim()) patch.roblox.apiKey = $('ex-key').value.trim();
  await saveSettings(patch); await keyState();
  $('ex-status').textContent = 'Uploading textures to Roblox…';
  const list = $('ex-all').checked ? await Promise.all(effects.map(e => json('/api/vfx/' + e.id))) : [current];
  if (!await uploadMissing(list)) { $('ex-status').textContent = 'Upload cancelled.'; return; }
  $('ex-status').textContent = 'Building package with the new ids…';
  const r = await exportPackage({ ...exOpts(), placeholder: true });
  $('ex-status').textContent = `✓ ${r.file} · ids written into the Luau CONFIG, .rbxm and asset map${r.missing.length ? ` · ${r.missing.length} still decal-only (resolved in Roblox automatically)` : ''}`;
  refreshExportIssues();
});
$('ex-copy').onclick = guard(async () => {
  const list = $('ex-all').checked ? await Promise.all(effects.map(e => json('/api/vfx/' + e.id))) : [current], ids = imageIds();
  const tex = list.flatMap(e => texturePaths(e).map(t => ({ ...t, imageId: ids[t.key] ?? null, decalId: assets['decal:' + t.key] ?? null })));
  await navigator.clipboard.writeText(luauFor(list, tex, await controller)); toast('Luau ModuleScript copied: paste it into ReplicatedStorage and fill CONFIG.Textures');
});
$('ex-go').onclick = guard(async () => { $('ex-status').textContent = 'Building…'; const r = await exportPackage(exOpts()); $('ex-status').textContent = `✓ ${r.file} (${(r.bytes / 1024).toFixed(0)} KB)${r.missing.length ? ` · ${r.missing.length} texture(s) need ids → importer` : ''}`; status(`Exported ${r.file}`); });

// ---------- live reload + boot ----------
new EventSource('/api/events').onmessage = guard(async e => { let d = {}; try { d = JSON.parse(e.data); } catch {} if (!d.dirs?.includes('vfx')) return; await refreshList(); await loadIds(); if (effectId && !dirty) await open(effectId); });
window.codexVFX = { generateLuau: async (all = false) => { const list = all ? await Promise.all(effects.map(e => json('/api/vfx/' + e.id))) : [current], ids = imageIds(); return luauFor(list, list.flatMap(e => texturePaths(e).map(t => ({ ...t, imageId: ids[t.key] ?? null, decalId: assets['decal:' + t.key] ?? null }))), await controller); }, open: guard(open), get effect() { return current; }, set effect(v) { current = v; changed(true); }, validate, exportPackage, uploadMissing, preview, snapshot: () => preview.snapshot(), library: () => library, generate };
await guard(async () => {
  await Promise.all([loadLibrary(), loadIds(), refreshList()]); genPreview(); const s = settingsCache = await getSettings();
  preview.quality = s.vfx?.quality === 'Low' ? 0.35 : s.vfx?.quality === 'Medium' ? 0.65 : 1;
  const want = new URLSearchParams(location.search).get('effect'); if (want || effects[0]) await open(want ?? effects[0].id); else newEffect();
  status('VFX Studio ready');
})();
