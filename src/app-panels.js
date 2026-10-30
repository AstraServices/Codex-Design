// Selection picking, Roblox highlight editor and asset-library browser for the workshop UI.
import * as THREE from 'three';
import { collectHighlights, setHighlight, inspectHighlights, MAX_HIGHLIGHTS } from './highlight.js';
import { findAssets, assetURL } from './textures.js';
import { collectEdges, setEdges, EDGE_DEFAULTS } from './edges.js';

const SELECT_STYLE = { enabled: true, fillColor: '#1aa3ff', fillTransparency: 0.86, outlineColor: '#1aa3ff', outlineTransparency: 0, depthMode: 'AlwaysOnTop', outlineWidth: 2, glow: 0, glowColor: null, glowTransparency: 1, fillStyle: 'solid', pulse: null };
const HOVER_STYLE = { ...SELECT_STYLE, fillTransparency: 1, outlineColor: '#a8dcff', outlineTransparency: 0.35, outlineWidth: 1.5 };
const RECIPE_DEFAULTS = { enabled: true, outlineWidth: 3, glow: 0, glowColor: null, glowTransparency: 0.35, fillStyle: 'solid', pulse: null };

/** ctx: {$, fx, renderer, camera, getAsset, message, guarded, stats} */
export function createPanels(ctx) {
  const { $, fx, renderer, camera, message, guarded } = ctx;
  let selected = null, hovered = null, entries = [], edgeEntries = [];
  const asset = () => ctx.getAsset();

  function updateExtras() { fx.extra = [hovered && hovered !== selected ? { object: hovered, settings: HOVER_STYLE } : null, selected ? { object: selected, settings: SELECT_STYLE } : null].filter(Boolean); }
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const visibleChain = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  function pick(event) {
    if (!asset()) return null; const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObject(asset().root, true).find(h => !h.object.userData.codexHighlightShell && visibleChain(h.object))?.object ?? null;
  }
  const objectPath = o => { const parts = []; for (let p = o; p && p !== asset().root.parent; p = p.parent) parts.unshift(p.name || p.type); return parts.join(' / '); };
  function renderSelection() {
    const info = $('selection-info'); info.replaceChildren(); $('sel-highlight').disabled = $('sel-copy').disabled = $('sel-edges').disabled = !selected;
    if (!selected) { info.textContent = 'Click a part in the viewport to inspect it. Alt+click selects its parent.'; return; }
    const g = selected.geometry, mats = selected.material ? (Array.isArray(selected.material) ? selected.material : [selected.material]) : [];
    const rows = [['Name', selected.name || '(unnamed)'], ['Path', objectPath(selected)], ['Type', selected.isSkinnedMesh ? 'SkinnedMesh' : selected.isMesh ? 'Mesh' : selected.type]];
    if (g) rows.push(['Triangles', ((g.index?.count ?? g.attributes.position.count) / 3).toLocaleString()]);
    if (mats.length) rows.push(['Materials', mats.map(m => m.name || m.type).join(', ')]);
    if (selected.userData.asset) rows.push(['Asset', selected.userData.asset.split('/').pop()]);
    if (selected.userData.robloxPart) rows.push(['Part', `${selected.userData.robloxPart.surface} · ${selected.userData.robloxPart.size.map(n => +n.toFixed(2)).join('×')} m`]);
    const own = selected.userData.codexHighlight; if (own) rows.push(['Highlight', own.name]);
    if (selected.userData.codexEdges) rows.push(['Edge outline', selected.userData.codexEdges.name]);
    for (const [l, v] of rows) { const row = document.createElement('div'); row.className = 'structure-row'; const a = document.createElement('span'), b = document.createElement('b'); a.textContent = l; b.textContent = v; b.title = v; row.append(a, b); info.append(row); }
    $('sel-highlight').textContent = own ? '✦ Edit highlight' : '✦ Highlight part';
    $('sel-edges').textContent = selected.userData.codexEdges ? '▢ Edit edges' : '▢ Edge outline';
  }
  function select(object) { selected = object; updateExtras(); renderSelection(); if (object) message(`Selected ${objectPath(object)}`); dispatchEvent(new CustomEvent('codex-select', { detail: object })); }

  let downAt = null, hoverEvent = null;
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', e => { if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return; downAt = null; let o = pick(e); if (o && e.altKey && o.parent && o.parent !== asset().root) o = o.parent; select(o); });
  canvas.addEventListener('pointermove', e => { if (e.buttons) { hovered = null; updateExtras(); return; } hoverEvent = e; });
  canvas.addEventListener('pointerleave', () => { hoverEvent = null; hovered = null; updateExtras(); canvas.style.cursor = ''; });
  setInterval(() => { if (!hoverEvent) return; const o = pick(hoverEvent); hoverEvent = null; if (o !== hovered) { hovered = o; updateExtras(); canvas.style.cursor = o ? 'pointer' : ''; } }, 60);

  $('sel-copy').onclick = guarded(async () => { await navigator.clipboard.writeText(selected.name); message(`Copied "${selected.name}"`); });
  $('sel-highlight').onclick = () => {
    if (!selected) return;
    if (!selected.userData.codexHighlight) { setHighlight(selected, { fillColor: '#ffcc33', fillTransparency: 0.65, outlineColor: '#ffffff' }); refresh(); }
    renderHighlights(selected.userData.codexHighlight.name); renderSelection();
  };
  $('sel-edges').onclick = () => {
    if (!selected) return;
    if (!selected.userData.codexEdges) { setEdges(selected, {}); refresh(); }
    renderEdgeList(selected.userData.codexEdges.name); renderSelection();
  };
  $('highlights').onclick = () => { fx.enabled = !fx.enabled; $('highlights').setAttribute('aria-pressed', String(fx.enabled)); message(fx.enabled ? 'Highlights visible' : 'Highlights hidden (selection still shown)'); };
  document.addEventListener('keydown', e => { if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return; if (e.key === 'Escape') select(null); if (e.key.toLowerCase() === 'h') $('highlights').click(); });

  function highlightCode(entry) {
    const s = entry.settings, keys = ['fillColor', 'fillTransparency', 'outlineColor', 'outlineTransparency', 'depthMode', 'enabled', 'outlineWidth', 'glow', 'glowColor', 'glowTransparency', 'fillStyle', 'pulse'];
    const body = keys.filter(k => !(k in RECIPE_DEFAULTS) || JSON.stringify(s[k]) !== JSON.stringify(RECIPE_DEFAULTS[k])).map(k => `${k}:${JSON.stringify(s[k])}`).join(',');
    return `k.highlight('${entry.object === asset().root ? 'Asset' : entry.object.name}',{${body}});`;
  }
  function renderHighlights(open) {
    const list = $('hl-list'); list.replaceChildren(); $('hl-count').textContent = `${entries.length} / ${MAX_HIGHLIGHTS}`;
    if (!entries.length) { const p = document.createElement('p'); p.className = 'fine'; p.textContent = 'No highlights. Select a part and press “Highlight part”, or add k.highlight(…) in the recipe.'; list.append(p); return; }
    for (const entry of entries) {
      const s = entry.settings, item = document.createElement('details'); item.className = 'hl-item'; item.open = open === s.name;
      const summary = document.createElement('summary'), enabled = document.createElement('input'), swatch = document.createElement('span'), title = document.createElement('span');
      const update = patch => { setHighlight(entry.object, patch); entry.settings = entry.object.userData.codexHighlight; paint(); };
      enabled.type = 'checkbox'; enabled.checked = s.enabled; enabled.setAttribute('aria-label', `Enable ${s.name}`); enabled.onclick = e => e.stopPropagation(); enabled.onchange = () => update({ enabled: enabled.checked });
      swatch.className = 'hl-swatch'; const paint = () => { swatch.style.background = entry.settings.fillColor; swatch.style.borderColor = entry.settings.outlineColor; }; paint();
      title.className = 'hl-title'; title.textContent = `${s.name} · ${entry.object.name || 'Asset'}`; summary.append(enabled, swatch, title); item.append(summary);
      const body = document.createElement('div'); body.className = 'hl-body';
      const field = (label, key, type, opts = {}) => {
        const wrap = document.createElement('label'); wrap.className = 'hl-field'; wrap.textContent = label; let input;
        if (type === 'select') { input = document.createElement('select'); for (const o of opts.options) { const op = document.createElement('option'); op.value = op.textContent = o; input.append(op); } input.value = String(entry.settings[key]); }
        else { input = document.createElement('input'); input.type = type; if (type === 'range') { input.min = opts.min; input.max = opts.max; input.step = opts.step; } input.value = entry.settings[key] ?? entry.settings.outlineColor; }
        input.setAttribute('aria-label', `${s.name} ${label}`);
        const out = document.createElement('output'); if (type === 'range') out.textContent = input.value;
        input.oninput = () => { update({ [key]: type === 'range' ? Number(input.value) : input.value }); out.textContent = input.value; };
        wrap.append(input); if (type === 'range') wrap.append(out); body.append(wrap);
      };
      field('FillColor', 'fillColor', 'color'); field('FillTransparency', 'fillTransparency', 'range', { min: 0, max: 1, step: 0.01 });
      field('OutlineColor', 'outlineColor', 'color'); field('OutlineTransparency', 'outlineTransparency', 'range', { min: 0, max: 1, step: 0.01 });
      field('DepthMode', 'depthMode', 'select', { options: ['AlwaysOnTop', 'Occluded'] });
      field('Outline width (px)', 'outlineWidth', 'range', { min: 0, max: 12, step: 0.5 }); field('Glow (px)', 'glow', 'range', { min: 0, max: 24, step: 1 }); field('Glow color', 'glowColor', 'color');
      field('Fill style', 'fillStyle', 'select', { options: ['solid', 'fresnel', 'stripes'] });
      const pulse = document.createElement('label'); pulse.className = 'hl-field'; pulse.textContent = 'Pulse (TweenService loop)'; const pc = document.createElement('input'); pc.type = 'checkbox'; pc.checked = !!entry.settings.pulse; pc.onchange = () => update({ pulse: pc.checked ? { speed: 1, amount: 0.35 } : null }); pulse.append(pc); body.append(pulse);
      const actions = document.createElement('div'); actions.className = 'selection-actions';
      const copy = document.createElement('button'); copy.textContent = 'Copy recipe code'; copy.onclick = guarded(async () => { await navigator.clipboard.writeText(highlightCode(entry)); message('Highlight code copied · paste into build(k)'); });
      const sel = document.createElement('button'); sel.textContent = 'Select'; sel.onclick = () => select(entry.object);
      const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.onclick = () => { setHighlight(entry.object, null); refresh(); renderSelection(); };
      actions.append(copy, sel, remove); body.append(actions); item.append(body); list.append(item);
    }
  }
  function edgeCode(entry) {
    const s = entry.settings, body = Object.keys(EDGE_DEFAULTS).filter(k => JSON.stringify(s[k]) !== JSON.stringify(EDGE_DEFAULTS[k])).map(k => `${k}:${JSON.stringify(s[k])}`).join(',');
    return `k.edges('${entry.object === asset().root ? 'Asset' : entry.object.name}',{${body}});`;
  }
  function renderEdgeList(open) {
    const list = $('edge-list'); list.replaceChildren(); $('edge-count').textContent = String(edgeEntries.length);
    if (!edgeEntries.length) { const p = document.createElement('p'); p.className = 'fine'; p.textContent = 'No edge outlines. Select a part and press “Edge outline”, or add k.edges(…) in the recipe.'; list.append(p); return; }
    for (const entry of edgeEntries) {
      const s = entry.settings, item = document.createElement('details'); item.className = 'hl-item'; item.open = open === s.name;
      const summary = document.createElement('summary'), enabled = document.createElement('input'), swatch = document.createElement('span'), title = document.createElement('span');
      const paint = () => { swatch.style.background = entry.settings.fill ? entry.settings.fillColor : 'transparent'; swatch.style.borderColor = entry.settings.color; };
      const update = patch => { setEdges(entry.object, patch); entry.settings = entry.object.userData.codexEdges; paint(); };
      enabled.type = 'checkbox'; enabled.checked = s.enabled; enabled.setAttribute('aria-label', `Enable ${s.name}`); enabled.onclick = e => e.stopPropagation(); enabled.onchange = () => update({ enabled: enabled.checked });
      swatch.className = 'hl-swatch'; paint(); title.className = 'hl-title'; title.textContent = `${s.name} · ${entry.object.name || 'Asset'}`; summary.append(enabled, swatch, title); item.append(summary);
      const body = document.createElement('div'); body.className = 'hl-body';
      const field = (label, key, type, opts = {}) => {
        const wrap = document.createElement('label'); wrap.className = 'hl-field'; wrap.textContent = label; let input;
        if (type === 'select') { input = document.createElement('select'); for (const o of opts.options) { const op = document.createElement('option'); op.value = op.textContent = o; input.append(op); } input.value = String(entry.settings[key]); }
        else { input = document.createElement('input'); input.type = type; if (type === 'range') { input.min = opts.min; input.max = opts.max; input.step = opts.step; } if (type === 'checkbox') input.checked = !!entry.settings[key]; else input.value = entry.settings[key]; }
        input.setAttribute('aria-label', `${s.name} ${label}`);
        const out = document.createElement('output'); if (type === 'range') out.textContent = input.value;
        input.oninput = input.onchange = () => { update({ [key]: type === 'range' ? Number(input.value) : type === 'checkbox' ? input.checked : input.value }); out.textContent = input.value; };
        wrap.append(input); if (type === 'range') wrap.append(out); body.append(wrap);
      };
      field('Line color', 'color', 'color'); field('Line transparency', 'transparency', 'range', { min: 0, max: 1, step: 0.01 });
      field('Thickness (px)', 'thickness', 'range', { min: 0.5, max: 8, step: 0.5 }); field('Crease angle (°)', 'creaseAngle', 'range', { min: 5, max: 90, step: 1 });
      field('Silhouette', 'silhouette', 'checkbox'); field('Hard edges', 'creases', 'checkbox'); field('DepthMode', 'depthMode', 'select', { options: ['Occluded', 'AlwaysOnTop'] });
      field('Fill inside', 'fill', 'checkbox'); field('Fill color', 'fillColor', 'color'); field('Fill transparency', 'fillTransparency', 'range', { min: 0, max: 1, step: 0.01 });
      const actions = document.createElement('div'); actions.className = 'selection-actions';
      const copy = document.createElement('button'); copy.textContent = 'Copy recipe code'; copy.onclick = guarded(async () => { await navigator.clipboard.writeText(edgeCode(entry)); message('Edge outline code copied · paste into build(k)'); });
      const sel = document.createElement('button'); sel.textContent = 'Select'; sel.onclick = () => select(entry.object);
      const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.onclick = () => { setEdges(entry.object, null); refresh(); renderSelection(); };
      actions.append(copy, sel, remove); body.append(actions); item.append(body); list.append(item);
    }
  }
  function refresh(open) { entries = asset() ? collectHighlights(asset().root) : []; edgeEntries = asset() ? collectEdges(asset().root) : []; renderHighlights(open); renderEdgeList(open); ctx.stats(); return [...entries, ...edgeEntries]; }

  let timer, ticket = 0;
  async function searchLibrary() {
    const q = $('asset-search').value.trim(), kind = $('asset-kind').value, mine = ++ticket, grid = $('asset-grid');
    if (!q) { grid.replaceChildren(); $('asset-hint').textContent = 'Try “coin”, “gem”, “stud”, “chest”, “sparkle”. Click a tile to copy its recipe snippet.'; return; }
    const hits = await findAssets(q, { kind: kind || undefined, limit: 24 }); if (mine !== ticket) return;
    grid.replaceChildren(); $('asset-hint').textContent = hits.length ? `${hits.length} result${hits.length > 1 ? 's' : ''} · click copies a snippet · use icons only where the model needs one` : 'No matches.';
    for (const h of hits) {
      const b = document.createElement('button'); b.className = 'asset-tile'; b.title = `${h.name}\n${h.path}`;
      const img = document.createElement('img'); img.loading = 'lazy'; img.alt = h.name; img.src = assetURL(h.path); b.append(img);
      const studTexture = /stud/i.test(h.path) && h.kind === 'texture';
      const snippet = h.kind === 'icon' ? `await k.iconBadge('${h.name.replace(/[^A-Za-z0-9]/g, '')}Badge','${h.path}',{size:1,at:[0,1,0]});` : studTexture ? `await k.part('Block',[2,0.4,2],'#4caf50',{top:'kek'}); // stud styles: npm run assets -- --studs` : `await k.texture('${h.path}',{repeat:1})`;
      b.onclick = guarded(async () => { await navigator.clipboard.writeText(snippet); message(`Copied snippet for ${h.name}`); });
      grid.append(b);
    }
  }
  $('asset-search').oninput = () => { clearTimeout(timer); timer = setTimeout(guarded(searchLibrary), 180); }; $('asset-kind').onchange = guarded(searchLibrary);

  return {
    /** Call after a new asset is installed. */
    reset() { selected = hovered = null; updateExtras(); renderSelection(); return refresh(); },
    get entries() { return [...entries, ...edgeEntries]; },
    api: {
      highlights: () => inspectHighlights(asset().root),
      setHighlight(name, settings) { const o = name === 'Asset' ? asset().root : asset().root.getObjectByName(name); if (!o) throw new Error(`No object named ${name}`); const r = setHighlight(o, settings); refresh(); return r; },
      setEdges(name, settings) { const o = name === 'Asset' ? asset().root : asset().root.getObjectByName(name); if (!o) throw new Error(`No object named ${name}`); const r = setEdges(o, settings); refresh(); return r; },
      select(name) { select(name ? asset().root.getObjectByName(name) ?? null : null); return selected?.name ?? null; },
    },
  };
}
