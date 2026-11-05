// Texture Studio page: material list, node palette, graph editor (pan/zoom, drag, connect), node inspector, outputs,
// live evaluation in a worker (GPU path on the page for GLSL nodes), map strip, 3D preview + painting + geometry masks,
// PBR/seam validation, multi-engine export (ZIP + exports/texture/), atlas and Roblox upload. window.codexTexture = API.
import { zipSync, zlibSync, strToU8 } from 'fflate';
import { mountShell, toast, uploadToRoblox, getSettings } from '../studio/shell.js';
import { NODES, CATEGORIES, MAPS, defaults, checkGraph, pruneGraph, evaluate, toRGBA } from './graph.js';
import { PROFILES, PLATFORMS, exportMaterial, atlas, resizeMaps } from './export.js';
import { TextureView } from './view3d.js';
import { encodePNG } from '../png.js';

mountShell({ current: 'TEXTURE STUDIO' });
const $ = id => document.getElementById(id), status = t => { $('status').textContent = t; };
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { console.error(e); toast(e.message, { error: true, ms: 7000 }); status(e.message); } };
const json = async (url, opt) => { const r = await fetch(url, opt); const b = await r.json(); if (!r.ok) throw new Error(b.error || r.statusText); return b; };
const view = new TextureView($('view3d'));
let graph = null, graphId = null, dirty = false, selected = null, list = [], result = null, nodeThumbs = {}, zoom = 1, pan = { x: 20, y: 20 }, mapShown = 'baseColor', settings = null;

// ---------- evaluation (worker; page GPU when GLSL nodes exist) ----------
const worker = new Worker('/src/texture/worker.js', { type: 'module' }); let jobId = 0; const jobs = new Map();
worker.onmessage = ({ data }) => { const j = jobs.get(data.id); if (!j) return; if (data.progress !== undefined) { $('eval-state').textContent = `evaluating ${Math.round(data.progress * 100)}%`; return; } jobs.delete(data.id); data.error ? j.reject(new Error(data.error)) : j.resolve(data.result); };
let gl = null; function gpu(code, a, b, S) { // Custom GLSL node: fragment shader over two inputs → RGBA (read back as 0–1 color)
  gl ??= document.createElement('canvas').getContext('webgl2', { preserveDrawingBuffer: true }); if (!gl) throw new Error('WebGL2 not available for GLSL nodes');
  const c = gl.canvas; c.width = c.height = S; const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error('GLSL: ' + gl.getShaderInfoLog(x)); return x; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p; out vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }'));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float; in vec2 uv; out vec4 o; uniform sampler2D A; uniform sampler2D B;\n${code}\nvoid main(){ vec2 u = vec2(uv.x, 1.0-uv.y); o = node(u, texture(A,u), texture(B,u)); }`)); gl.linkProgram(p); gl.useProgram(p);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW); const loc = gl.getAttribLocation(p, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  [a, b].forEach((img, i) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(toRGBA(img, S).buffer)); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT); gl.uniform1i(gl.getUniformLocation(p, 'AB'[i]), i); });
  gl.viewport(0, 0, S, S); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); const px = new Uint8Array(S * S * 4); gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const o = new Float32Array(S * S * 3); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const src = ((S - 1 - y) * S + x) * 4, k = (y * S + x) * 3; o[k] = px[src] / 255; o[k + 1] = px[src + 1] / 255; o[k + 2] = px[src + 2] / 255; } return { c: 3, d: o };
}
async function subgraphs(g, seen = {}) { for (const n of g.nodes) if (n.type === 'subgraph' && n.params?.graph && !seen[n.params.graph]) { seen[n.params.graph] = await json(`/api/textures/${n.params.graph}`); await subgraphs(seen[n.params.graph], seen); } return seen; }
async function run(g, size, { capture = false } = {}) {
  const masks = view.masks && Object.fromEntries(Object.entries(view.masks).filter(([, m]) => m.size === size)), subs = await subgraphs(g);
  if (g.nodes.some(n => n.type === 'glsl')) { const r = await evaluate(g, { size, seed: g.seed, gpu, capture, mesh: (k, S) => masks?.[k] && masks[k].size === S ? { c: masks[k].c ?? 1, d: masks[k].d } : null, loadGraph: async n => subs[n] }); const { validatePBR, seamScore } = await import('./graph.js'); return capture ? { nodes: r.nodes, size } : { ...r, issues: validatePBR(r.maps, size), seams: Object.fromEntries(['baseColor', 'height', 'roughness'].filter(k => r.maps[k]).map(k => [k, +seamScore(r.maps[k], size).score.toFixed(3)])) }; }
  const id = ++jobId; return new Promise((resolve, reject) => { jobs.set(id, { resolve, reject }); worker.postMessage({ id, graph: g, size, seed: g.seed, meshMasks: masks, subgraphs: subs, capture }); });
}
let evalTimer, evalSeq = 0;
function schedule() { clearTimeout(evalTimer); evalTimer = setTimeout(guard(refresh), 160); }
async function refresh() {
  if (!graph) return; const seq = ++evalSeq, size = +$('psize').value, t = performance.now(); $('eval-state').textContent = 'evaluating…';
  const issues = checkGraph(graph); if (issues.some(i => i.level === 'error')) { showIssues(issues); $('eval-state').textContent = 'graph has errors'; return; }
  const r = await run(graph, size); if (seq !== evalSeq) return; result = r; view.setMaps(r.maps, size); drawStrip(); showIssues([...issues, ...r.issues, ...(r.derived.length ? [{ level: 'info', message: 'Derived: ' + r.derived.join(' · ') }] : [])]);
  $('eval-state').textContent = `${size}² · ${Math.round(performance.now() - t)} ms · seams ${Object.entries(r.seams).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' ')}`;
  const th = await run(graph, 64, { capture: true }); if (seq !== evalSeq) return; nodeThumbs = th.nodes; drawThumbs();
}
const thumbCanvas = (b, S, c = document.createElement('canvas')) => { c.width = c.height = S; c.getContext('2d').putImageData(new ImageData(toRGBA(b, S), S, S), 0, 0); return c; };
function drawThumbs() { for (const el of $('world').querySelectorAll('.node')) { const b = nodeThumbs[el.dataset.id], cv = el.querySelector('canvas'); if (b && cv) thumbCanvas(b, 64, cv); } }
function drawStrip() {
  const box = $('maps'); box.replaceChildren();
  for (const m of MAPS) { const b = result?.maps[m]; if (!b) continue; const btn = document.createElement('button'); btn.setAttribute('aria-pressed', m === mapShown); const cv = thumbCanvas(b, result.size); btn.append(cv); const s = document.createElement('small'); s.textContent = m + (graph.outputs?.[m] ? '' : ' (auto)'); btn.append(s); btn.onclick = () => { mapShown = m; $('channel').value = ['height', 'curvature', 'thickness'].includes(m) || MAPS.includes(m) ? m : 'lit'; view.setChannel(m); drawStrip(); }; box.append(btn); }
}
function showIssues(issues) {
  const e = issues.filter(i => i.level === 'error').length, w = issues.filter(i => i.level === 'warn').length; $('val-summary').textContent = e ? `${e} ERROR` : w ? `${w} WARN` : 'OK ✓';
  $('issues').replaceChildren(...issues.map(i => { const r = document.createElement('div'); r.className = 'issue'; r.innerHTML = `<span class="badge ${{ error: 'err', warn: 'warn', info: 'info' }[i.level] ?? ''}">${i.level.toUpperCase()}</span><span></span>`; r.lastChild.textContent = i.message; return r; }));
}

// ---------- graph editor ----------
const world = $('world'), svg = $('wires'), host = $('graph');
const applyView = () => { world.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom})`; drawWires(); };
function portPos(nodeId, port, side) { const el = world.querySelector(`.node[data-id="${CSS.escape(nodeId)}"] .${side === 'out' ? 'outs' : 'ins'} [data-port="${port}"] .dot`); if (!el) return null; const r = el.getBoundingClientRect(), h = host.getBoundingClientRect(); return [r.left + r.width / 2 - h.left, r.top + r.height / 2 - h.top]; }
const curve = ([x1, y1], [x2, y2]) => { const d = Math.max(40, Math.abs(x2 - x1) * 0.5); return `M${x1},${y1} C${x1 + d},${y1} ${x2 - d},${y2} ${x2},${y2}`; };
let live = null;
function drawWires() {
  const paths = []; for (const n of graph?.nodes ?? []) for (const [k, src] of Object.entries(n.inputs ?? {})) { if (!src) continue; const a = portPos(src, 'out', 'out'), b = portPos(n.id, k, 'in'); if (a && b) paths.push(`<path d="${curve(a, b)}"/>`); }
  if (live) paths.push(`<path class="live" d="${curve(live.a, live.b)}"/>`); svg.innerHTML = paths.join('');
}
function nodeEl(n) {
  const def = NODES[n.type] ?? { label: n.type, in: [], out: 'gray' }, el = document.createElement('div'); el.className = 'node' + (n.id === selected ? ' selected' : '') + (Object.values(graph.outputs ?? {}).includes(n.id) ? ' output-node' : ''); el.dataset.id = n.id; el.style.left = (n.x ?? 0) + 'px'; el.style.top = (n.y ?? 0) + 'px';
  el.innerHTML = `<header><b></b><small></small></header><div class="ports"><div class="ins"></div><div class="outs"><div class="port" data-port="out"><span class="dot"></span><span>${def.out}</span></div></div></div><canvas width="64" height="64"></canvas><div class="tags"></div>`;
  el.querySelector('b').textContent = def.label; el.querySelector('small').textContent = n.id;
  for (const k of def.in ?? []) { const p = document.createElement('div'); p.className = 'port' + (n.inputs?.[k] ? ' connected' : ''); p.dataset.port = k; p.innerHTML = '<span class="dot"></span><span></span>'; p.lastChild.textContent = k; el.querySelector('.ins').append(p);
    p.onpointerdown = e => { e.stopPropagation(); if (n.inputs?.[k]) { delete n.inputs[k]; changed(true); } }; }
  for (const [m, id] of Object.entries(graph.outputs ?? {})) if (id === n.id) { const t = document.createElement('span'); t.textContent = m; el.querySelector('.tags').append(t); }
  const head = el.querySelector('header'); head.onpointerdown = e => { e.stopPropagation(); select(n.id); const sx = e.clientX, sy = e.clientY, ox = n.x ?? 0, oy = n.y ?? 0; head.setPointerCapture(e.pointerId);
    head.onpointermove = m => { n.x = Math.round(ox + (m.clientX - sx) / zoom); n.y = Math.round(oy + (m.clientY - sy) / zoom); el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; drawWires(); }; head.onpointerup = () => { head.onpointermove = null; dirty = true; syncJSON(); }; };
  el.onpointerdown = e => { e.stopPropagation(); select(n.id); };
  const out = el.querySelector('.outs .port'); out.onpointerdown = e => { e.stopPropagation(); const a = portPos(n.id, 'out', 'out'); live = { from: n.id, a, b: a }; host.setPointerCapture(e.pointerId); };
  return el;
}
function renderGraph() { world.replaceChildren(...(graph?.nodes ?? []).map(nodeEl)); requestAnimationFrame(() => { drawWires(); drawThumbs(); }); renderOutputs(); }
host.addEventListener('pointermove', e => { if (live) { const h = host.getBoundingClientRect(); live.b = [e.clientX - h.left, e.clientY - h.top]; drawWires(); } });
host.addEventListener('pointerup', e => { if (!live) return; const target = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.closest?.('.ins .port'))?.closest('.ins .port'); if (target) { const to = target.closest('.node').dataset.id; if (to !== live.from) { const n = graph.nodes.find(x => x.id === to); n.inputs ??= {}; n.inputs[target.dataset.port] = live.from; changed(true); } } live = null; drawWires(); });
host.addEventListener('pointerdown', e => { if (e.target !== host && e.target !== world && e.target !== svg) return; select(null); const sx = e.clientX - pan.x, sy = e.clientY - pan.y; host.classList.add('panning'); host.setPointerCapture(e.pointerId); const mv = m => { pan = { x: m.clientX - sx, y: m.clientY - sy }; applyView(); }; host.addEventListener('pointermove', mv); host.addEventListener('pointerup', () => { host.removeEventListener('pointermove', mv); host.classList.remove('panning'); }, { once: true }); });
host.addEventListener('wheel', e => { e.preventDefault(); const h = host.getBoundingClientRect(), mx = e.clientX - h.left, my = e.clientY - h.top, z = Math.min(2, Math.max(0.3, zoom * (e.deltaY < 0 ? 1.1 : 0.9))); pan = { x: mx - (mx - pan.x) * z / zoom, y: my - (my - pan.y) * z / zoom }; zoom = z; applyView(); }, { passive: false });
function fit() { if (!graph?.nodes.length) return; const xs = graph.nodes.map(n => n.x ?? 0), ys = graph.nodes.map(n => n.y ?? 0), w = Math.max(...xs) - Math.min(...xs) + 200, h = Math.max(...ys) - Math.min(...ys) + 200, r = host.getBoundingClientRect(); zoom = Math.min(1.2, Math.max(0.3, Math.min(r.width / w, r.height / h))); pan = { x: 20 - Math.min(...xs) * zoom, y: 20 - Math.min(...ys) * zoom }; applyView(); }
addEventListener('keydown', e => { if (e.target.closest('input,textarea,select')) return; if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { graph.nodes = graph.nodes.filter(n => n.id !== selected); for (const n of graph.nodes) for (const [k, v] of Object.entries(n.inputs ?? {})) if (v === selected) delete n.inputs[k]; for (const [k, v] of Object.entries(graph.outputs ?? {})) if (v === selected) delete graph.outputs[k]; selected = null; changed(true); } if (e.key === 'f') fit(); if ((e.ctrlKey || e.metaKey) && e.key === 'z') view.undo(); });
addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); guard(save)(); } });

function select(id) { selected = id; world.querySelectorAll('.node').forEach(el => el.classList.toggle('selected', el.dataset.id === id)); renderInspector(); }
function renderInspector() {
  const box = $('inspector'), n = graph?.nodes.find(x => x.id === selected); $('node-id').textContent = n?.id ?? ''; if (!n) { box.textContent = 'Select a node.'; return; }
  const def = NODES[n.type], p = { ...defaults(n.type), ...n.params }; box.replaceChildren(); n.params ??= {};
  const add = (label, el) => { const l = document.createElement('label'); l.className = 'field'; l.append(label, el); box.append(l); return el; };
  const idIn = add('Node id', Object.assign(document.createElement('input'), { type: 'text', value: n.id })); idIn.onchange = () => { const v = idIn.value.trim().replace(/[^A-Za-z0-9_-]/g, ''); if (!v || graph.nodes.some(x => x.id === v)) return toast('Id must be unique', { error: true }); for (const m of graph.nodes) for (const [k, s] of Object.entries(m.inputs ?? {})) if (s === n.id) m.inputs[k] = v; for (const [k, s] of Object.entries(graph.outputs ?? {})) if (s === n.id) graph.outputs[k] = v; n.id = v; selected = v; changed(true); };
  for (const q of def.params) {
    const v = p[q.key]; let el;
    if (q.type === 'select') { el = document.createElement('select'); for (const o of q.options) el.append(new Option(o, o)); el.value = v; el.onchange = () => { n.params[q.key] = el.value; changed(); }; }
    else if (q.type === 'bool') { el = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!v }); el.onchange = () => { n.params[q.key] = el.checked; changed(); }; }
    else if (q.type === 'color') { el = Object.assign(document.createElement('input'), { type: 'color', value: v }); el.oninput = () => { n.params[q.key] = el.value; changed(); }; }
    else if (q.type === 'ramp') { el = Object.assign(document.createElement('input'), { type: 'text', value: v.map(([t, c]) => `${t}:${c}`).join(', ') }); el.onchange = () => { const s = el.value.split(',').map(x => x.trim().split(':')).filter(([t, c]) => Number.isFinite(+t) && /^#[0-9a-f]{6}$/i.test(c)).map(([t, c]) => [+t, c]); if (s.length >= 2) { n.params[q.key] = s; changed(); } else toast('Ramp format: 0:#112233, 0.5:#445566, 1:#ffffff', { error: true }); }; }
    else if (q.type === 'text' || q.type === 'code') { el = document.createElement(q.type === 'code' ? 'textarea' : 'input'); if (q.type === 'code') { el.rows = 7; el.className = 'code'; } el.value = v ?? ''; el.onchange = () => { n.params[q.key] = el.value; changed(); }; }
    else { el = document.createElement('div'); el.className = 'pair'; const r = Object.assign(document.createElement('input'), { type: 'range', min: q.min, max: q.max, step: q.step, value: v }), num = Object.assign(document.createElement('input'), { type: 'number', min: q.min, max: q.max, step: q.step, value: v });
      r.oninput = () => { num.value = r.value; n.params[q.key] = q.type === 'int' ? Math.round(+r.value) : +r.value; changed(); }; num.onchange = () => { r.value = num.value; n.params[q.key] = q.type === 'int' ? Math.round(+num.value) : +num.value; changed(); }; el.append(r, num); }
    add(q.key, el);
  }
  const outRow = document.createElement('div'); outRow.className = 'chips'; for (const m of ['baseColor', 'height', 'roughness', 'metalness', 'normal', 'emissive', 'opacity']) { const b = document.createElement('button'); b.type = 'button'; b.textContent = '→ ' + m; b.setAttribute('aria-pressed', graph.outputs?.[m] === n.id); b.onclick = () => { graph.outputs ??= {}; if (graph.outputs[m] === n.id) delete graph.outputs[m]; else graph.outputs[m] = n.id; changed(true); }; outRow.append(b); } box.append(outRow);
  const dup = document.createElement('button'); dup.type = 'button'; dup.className = 'full'; dup.textContent = 'Duplicate node'; dup.onclick = () => { const c = structuredClone(n); c.id = uid(n.type); c.x = (n.x ?? 0) + 30; c.y = (n.y ?? 0) + 30; graph.nodes.push(c); selected = c.id; changed(true); }; box.append(dup);
}
function renderOutputs() {
  const box = $('outputs'); box.replaceChildren(); if (!graph) return;
  for (const m of MAPS) { const r = document.createElement('div'); r.className = 'out-row'; const s = document.createElement('select'); s.append(new Option(m === 'normal' || m === 'ao' || m === 'curvature' || m === 'thickness' ? '(auto from height)' : '(default)', '')); for (const n of graph.nodes) s.append(new Option(`${n.id} · ${NODES[n.type]?.label ?? n.type}`, n.id)); s.value = graph.outputs?.[m] ?? ''; s.onchange = () => { graph.outputs ??= {}; if (s.value) graph.outputs[m] = s.value; else delete graph.outputs[m]; changed(true); }; r.append(m, s); box.append(r); }
}
const uid = type => { let i = 1; while (graph.nodes.some(n => n.id === `${type}${i}`)) i++; return `${type}${i}`; };
function renderPalette() {
  const q = $('node-search').value.trim().toLowerCase(), box = $('palette'); box.replaceChildren();
  for (const cat of CATEGORIES) { const items = Object.entries(NODES).filter(([k, d]) => d.cat === cat && (!q || (k + ' ' + d.label).toLowerCase().includes(q))); if (!items.length) continue; const c = document.createElement('div'); c.className = 'cat'; c.textContent = cat.toUpperCase(); box.append(c);
    for (const [k, d] of items) { const b = document.createElement('button'); b.type = 'button'; b.textContent = d.label; b.onclick = () => { if (!graph) newGraph(); const r = host.getBoundingClientRect(), n = { id: uid(k), type: k, params: defaults(k), inputs: {}, x: Math.round((r.width / 2 - pan.x) / zoom - 84), y: Math.round((r.height / 2 - pan.y) / zoom - 60) }; const s = graph.nodes.find(x => x.id === selected); if (s && d.in?.length) n.inputs[d.in[0]] = s.id; graph.nodes.push(n); selected = n.id; changed(true); }; box.append(b); } }
}
$('node-search').oninput = renderPalette;

// ---------- state / files ----------
function changed(structure = false) { dirty = true; status('Unsaved changes'); syncJSON(); if (structure) renderGraph(); else renderOutputs(); renderInspector(); schedule(); }
function syncJSON() { $('json').value = JSON.stringify(graph, null, 1); }
async function refreshList() { list = await json('/api/textures'); $('mat-count').textContent = list.length; $('mat-list').replaceChildren(...list.map(m => { const b = document.createElement('button'); b.className = 'list-item' + (m.id === graphId ? ' active' : ''); b.innerHTML = '<span>◧</span><span><b></b><small></small></span>'; b.querySelector('b').textContent = m.name; b.querySelector('small').textContent = (m.description || m.id).slice(0, 70); b.onclick = guard(() => open(m.id)); return b; })); }
async function open(id) { if (dirty && id !== graphId && !confirm('Discard unsaved changes?')) return; graph = await json('/api/textures/' + id); graph.nodes ??= []; graph.outputs ??= {}; graphId = id; dirty = false; selected = null; $('mat-title').textContent = graph.name ?? id; $('seed').value = graph.seed ?? 1; history.replaceState(null, '', '?material=' + id); view.clearPaint(); syncJSON(); renderGraph(); fit(); await refresh(); await refreshList(); status('Loaded ' + id); }
function newGraph() { graph = { name: 'new-material', description: '', seed: 1, nodes: [{ id: 'noise', type: 'fbm', params: defaults('fbm'), x: 40, y: 60 }, { id: 'albedo', type: 'colorRamp', params: defaults('colorRamp'), inputs: { in: 'noise' }, x: 280, y: 60 }], outputs: { baseColor: 'albedo', height: 'noise' } }; graphId = null; dirty = true; syncJSON(); renderGraph(); fit(); schedule(); }
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'm-$1').slice(0, 60) || 'material';
async function save() { if (!graph) return; const id = graphId ?? slug(graph.name); await json('/api/textures/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(graph) }); graphId = id; dirty = false; await refreshList(); toast(`Saved textures/${id}.graph.json`); status('Saved'); }
$('new-graph').onclick = () => { if (dirty && !confirm('Discard unsaved changes?')) return; newGraph(); const n = prompt('Material name', 'new-material'); if (n) { graph.name = slug(n); $('mat-title').textContent = graph.name; syncJSON(); } };
$('save').onclick = guard(save); $('fit').onclick = fit;
$('prune').onclick = () => { const { graph: g, removed } = pruneGraph(graph); if (!removed.length) return toast('Graph is already minimal: every node feeds an output.'); graph = g; changed(true); toast(`Removed ${removed.length} unused node(s): ${removed.join(', ')}`); };
$('seed').onchange = () => { graph.seed = +$('seed').value || 1; changed(); }; $('psize').onchange = schedule;
$('json-apply').onclick = guard(() => { const g = JSON.parse($('json').value); if (!Array.isArray(g.nodes)) throw new Error('Graph needs a "nodes" array'); graph = g; changed(true); });

// ---------- 3D view controls ----------
$('shape').onchange = () => { view.setShape($('shape').value); if (result) view.setMaps(result.maps, result.size, { keepB: false }); };
$('light').onchange = () => view.lighting($('light').value); $('channel').onchange = () => view.setChannel($('channel').value); $('repeat').onchange = () => view.setRepeat(+$('repeat').value || 1); $('wire').onchange = () => view.setWire($('wire').checked);
$('ab').onclick = () => { const b = view.toggleB(); $('ab').textContent = b ? 'B (previous)' : 'A/B'; };
$('glb-open').onclick = () => $('glb').click(); $('glb').onchange = guard(async () => { await view.loadGLB($('glb').files[0]); if (result) view.setMaps(result.maps, result.size, { keepB: false }); toast('Mesh loaded; bake masks to use its curvature/AO'); });
for (const b of $('paint-tools').querySelectorAll('button')) b.onclick = () => { $('paint-tools').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); const t = b.dataset.tool; view.paint.on = t !== 'off'; view.paint.tool = t; $('view3d').classList.toggle('painting', view.paint.on); $('paint-state').textContent = view.paint.on ? t.toUpperCase() : 'OFF'; };
const bindRange = (id, key, f = x => x) => { $(id).oninput = () => { view.paint[key] = f(+$(id).value); $(id + '-v').textContent = $(id).value; }; };
bindRange('paint-value', 'value'); bindRange('paint-size', 'radius'); $('paint-op').oninput = () => { view.paint.opacity = +$('paint-op').value; $('paint-op-v').textContent = $('paint-op').value; };
$('paint-channel').onchange = () => { view.paint.channel = $('paint-channel').value; }; $('paint-color').oninput = () => { view.paint.color = $('paint-color').value; }; $('paint-sym').onchange = () => { view.paint.symmetry = $('paint-sym').checked; };
$('paint-undo').onclick = () => view.undo() || toast('Nothing to undo'); $('paint-clear').onclick = () => view.clearPaint(view.paint.channel);
view.onPaint = () => { dirty = true; status('Painted (merged into exported maps)'); };
$('bake').onclick = guard(async () => { status('Baking geometry masks…'); await new Promise(r => setTimeout(r, 30)); const m = view.bakeMasks(+$('psize').value); $('mask-state').textContent = Object.keys(m).length + ' MASKS'; toast('Masks baked: use the “Mesh mask” node (curvature, convex, concave, slope, up, height, ao)'); schedule(); });

// ---------- UV + baking ----------
const uvReport = (title, o) => { const d = document.createElement('div'); d.className = 'issue'; d.innerHTML = '<span class="badge">OK</span><span></span>'; d.lastChild.textContent = `${title}: ${Object.entries(o).map(([k, v]) => `${k} ${v}`).join(' · ')}`; $('uv-report').prepend(d); };
$('uv-auto').onclick = guard(async () => { const r = view.autoUV({ angle: +$('uv-angle').value || 66 }); if (result) view.setMaps(result.maps, result.size, { keepB: false }); $('uv-state').textContent = `${r.islands} ISLANDS`; uvReport('Auto UV', { charts: r.charts, overlap: `${(r.overlap * 100).toFixed(1)}%`, stretch: r.stretch, utilization: `${Math.round(r.utilization * 100)}%`, flipped: r.flipped }); $('channel').value = 'uv'; view.setChannel('uv'); });
$('hi-open').onclick = () => $('hi-file').click();
$('hi-file').onchange = guard(async () => { const r = await view.loadHighPoly($('hi-file').files[0]); uvReport('High-poly', { triangles: r.triangles.toLocaleString() }); });
$('bake-go').onclick = guard(async () => { status('Baking high → low…'); await new Promise(r => setTimeout(r, 30)); const t = performance.now(), size = +$('bake-size').value, st = view.bake({ size, cage: +$('bake-cage').value, ao: +$('bake-ao').value }); uvReport('Baked', { size, coverage: `${Math.round(st.coverage * 100)}%`, 'high tris': st.highTriangles.toLocaleString(), ms: Math.round(performance.now() - t) });
  if (+$('psize').value !== size) $('psize').value = String(size); toast('Baked maps ready: add a “Baked map” node (normal / ao / height / curvature / position) and connect it to an output.'); schedule(); });

// ---------- export ----------
for (const [id, p] of Object.entries(PROFILES)) { const l = document.createElement('label'); l.innerHTML = `<input type="checkbox" value="${id}"${id.startsWith('roblox-surface') ? ' checked' : ''}> <span></span>`; l.lastChild.textContent = p.label; $('ex-profiles').append(l); }
for (const [id, p] of Object.entries(PLATFORMS)) $('ex-platform').append(new Option(`${p.label} · ≤${p.max} · ${p.format}`, id));
const chosen = () => [...$('ex-profiles').querySelectorAll('input:checked')].map(i => i.value);
async function evaluateFor(size) { const r = await run(graph, size); let maps = r.maps; if (Object.keys(view.paint.layers).length) { const S = view.size, painted = view.paintedMaps(resizeMaps(r.maps, size, S)); maps = { ...r.maps }; for (const ch of Object.keys(view.paint.layers)) maps[ch] = resizeMaps({ [ch]: painted[ch] }, S, size)[ch]; } return { ...r, maps }; }
async function exportZip({ profiles = chosen(), size = +$('ex-size').value, platform = $('ex-platform').value, assetIds, download = true } = {}) {
  if (!graph) throw new Error('No material'); if (!profiles.length) throw new Error('Choose at least one engine profile'); $('ex-status').textContent = `Evaluating at ${size}²…`;
  const name = slug(graph.name ?? graphId ?? 'material'), r = await evaluateFor(size), ids = assetIds ?? await json('/api/asset-ids').then(a => Object.fromEntries(Object.entries(a).filter(([k]) => k.startsWith('texture:')).map(([k, v]) => [k.slice(8), v])));
  const { files, report } = exportMaterial(name, r.maps, size, profiles, { deflate: zlibSync, platform, assetIds: ids });
  files[`${name}.graph.json`] = strToU8(JSON.stringify(graph, null, 1)); files['README.txt'] = strToU8(`Codex Design Texture Studio export: ${name}\nProfiles: ${profiles.join(', ')}\nEach folder has the maps for that engine plus <name>.material.json (slots, color spaces, packing, import notes).\nRoblox: upload the PNGs (or use Upload in Texture Studio), then put the image ids into the .rbxmx SurfaceAppearance / MaterialVariant.\nGPU compression (BC7/ASTC/ETC2) is applied by the engine on import; the report lists estimated memory.\n`);
  const zip = zipSync(files, { level: 6 }), file = `${name}_CodexDesign.textures.zip`, b64 = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(new Blob([zip])); });
  const saved = await json(`/api/export-file/texture/${file}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64: b64 }) });
  if (download) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' })); a.download = file; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  $('ex-report').replaceChildren(...report.map(x => { const d = document.createElement('div'); d.className = 'issue'; d.innerHTML = '<span class="badge">OK</span><span></span>'; d.lastChild.textContent = `${PROFILES[x.profile].label}: ${x.size}² · ${x.maps.join(', ')} · GPU ≈ ${x.gpuMB} MB compressed (${x.rawMB} MB RGBA8)`; return d; }));
  $('ex-status').textContent = `✓ ${saved.file} (${(zip.length / 1048576).toFixed(1)} MB)`; return { file: saved.file, report, files: Object.keys(files) };
}
$('export-open').onclick = guard(async () => { if (!graph) return toast('Open a material first', { error: true }); $('ex-name').textContent = graph.name; const s = await getSettings(true); $('ex-key-state').textContent = s.roblox.apiKeySet ? `KEY ${s.roblox.apiKeyHint}` : 'NO KEY (Settings)'; $('ex-size').value = s.texture?.exportSize ?? 1024;
  $('ex-atlas').replaceChildren(...list.map(m => { const b = document.createElement('button'); b.type = 'button'; b.textContent = m.name; b.dataset.id = m.id; b.setAttribute('aria-pressed', m.id === graphId); b.onclick = () => b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); return b; })); $('export-dialog').showModal(); });
$('ex-go').onclick = guard(() => exportZip());
$('ex-atlas-go').onclick = guard(async () => {
  const ids = [...$('ex-atlas').querySelectorAll('[aria-pressed=true]')].map(b => b.dataset.id); if (ids.length < 2) throw new Error('Select at least two materials for an atlas'); const size = +$('ex-size').value, cell = size / Math.ceil(Math.sqrt(ids.length)); $('ex-status').textContent = `Atlas: evaluating ${ids.length} materials…`;
  const mats = []; for (const id of ids) { const g = await json('/api/textures/' + id); const r = await run(g, Math.min(1024, 2 ** Math.ceil(Math.log2(cell)))); mats.push({ name: id, maps: r.maps, size: r.size }); }
  const A = atlas(mats, size, { padding: Math.max(2, size / 256) }), { files } = exportMaterial('atlas', A.maps, size, chosen().length ? chosen() : ['all-maps'], { deflate: zlibSync }); files['atlas.uv.json'] = strToU8(JSON.stringify({ size, rects: A.rects }, null, 1));
  const zip = zipSync(files), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([zip])); a.download = 'atlas_CodexDesign.textures.zip'; a.click(); $('ex-status').textContent = `✓ Atlas of ${ids.length} materials · UV rects in atlas.uv.json`;
});
$('ex-roblox').onclick = guard(async () => {
  const name = slug(graph.name), size = Math.min(1024, +$('ex-size').value), r = await evaluateFor(size), { files } = exportMaterial(name, r.maps, size, ['roblox-surfaceappearance'], { deflate: zlibSync });
  const pngs = Object.entries(files).filter(([k]) => k.endsWith('.png')), up = await uploadToRoblox(pngs.map(([k, bytes]) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return { base64: btoa(s), fileName: k.split('/').pop(), name: k.split('/').pop().replace('.png', ''), key: k.split('_').pop().replace('.png', '') }; }), { reason: `the material "${name}"` }); if (!up) return;
  const ids = {}, patch = {}; for (const u of up) { const id = u.imageId ?? u.decalId; ids[`${name}.${u.key}`] = id; patch[`texture:${name}.${u.key}`] = id; } await json('/api/asset-ids', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  const lua = `-- ${name}: SurfaceAppearance from Codex Design Texture Studio (paste into a Script or the command bar; set TARGET)\nlocal TARGET = workspace:FindFirstChildWhichIsA("MeshPart", true) -- your MeshPart\nlocal sa = Instance.new("SurfaceAppearance")\nsa.Name = "${name}"\n${['ColorMap', 'NormalMap', 'RoughnessMap', 'MetalnessMap'].filter(k => ids[`${name}.${k}`]).map(k => `sa.${k} = "rbxassetid://${ids[`${name}.${k}`]}"`).join('\n')}\nsa.Parent = TARGET\n-- Decal ids are fine in Studio; if a map looks wrong, open the Decal in Toolbox and use its image id.\n`;
  await exportZip({ profiles: chosen().includes('roblox-surfaceappearance') ? chosen() : ['roblox-surfaceappearance', ...chosen()], size, assetIds: ids, download: false }); await navigator.clipboard.writeText(lua).catch(() => {});
  toast(`Uploaded ${up.length} maps. Ids are in the .rbxmx; a SurfaceAppearance Luau snippet is on the clipboard.`, { ms: 8000 }); $('ex-status').textContent = `✓ Uploaded: ${up.map(u => `${u.key} ${u.imageId ?? 'decal ' + u.decalId}`).join(' · ')}`;
});

// ---------- live reload + boot ----------
new EventSource('/api/events').onmessage = guard(async e => { let d = {}; try { d = JSON.parse(e.data); } catch {} if (!d.dirs?.includes('textures')) return; await refreshList(); if (graphId && !dirty) await open(graphId); });
window.codexTexture = { autoUV: o => view.autoUV(o), bake: o => view.bake(o), uvStats: () => view.uvStats(), open: guard(open), get graph() { return graph; }, set graph(g) { graph = g; changed(true); }, refresh, exportZip, run, view, snapshot: () => view.snapshot(), nodes: NODES, profiles: PROFILES };
await guard(async () => {
  settings = await getSettings(); $('psize').value = String(settings.texture?.previewSize ?? 256); renderPalette(); applyView(); await refreshList();
  const want = new URLSearchParams(location.search).get('material'); if (want || list[0]) await open(want ?? list[0].id); else newGraph(); status('Texture Studio ready');
})();
