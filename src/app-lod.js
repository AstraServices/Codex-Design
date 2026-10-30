// LOD optimizer slider, smart topology fixer, quality score card, quad view and LOD-chain export.
import { optimizeLODAsync, LOD_LEVELS } from './lod.js';
import { geometryPool } from './worker-pool.js';
import { analyzeQuality, analyzeQualityAsync, fixTopology, smartTopology, createQuadOverlay } from './topology-quality.js';
import { zipSync, strToU8 } from 'fflate';

const CRITERIA = [['quads', 'Quad dominance'], ['ngons', 'No n-gon fans'], ['poles', 'Pole placement'], ['density', 'Even density'], ['triangles', 'Triangle quality'], ['manifold', 'Manifold / winding'], ['joints', 'Joint loops ≥3']];
const levelOf = pct => (pct < 25 ? 'LOD0' : pct < 62 ? 'LOD1' : pct < 82 ? 'LOD2' : 'LOD3');

/** ctx: {$, scene, getAsset, getProject, message, guarded, stats, refreshTopology, getUndo, setUndo, exportAsset, download} */
export function createLodPanel(ctx) {
  const { $, message, guarded } = ctx;
  let timer, quality = null, quadOverlay = null, lastLod = null, qualityTimer, qualityTicket = 0, ticket = 0, chain = Promise.resolve();
  // Hybrid preview: QEM runs on CPU worker threads (one mesh per thread) while the GPU keeps rendering the viewport.
  const pool = geometryPool(), lodRun = (r, opts) => optimizeLODAsync(r, opts, pool.simplify);
  const root = () => ctx.getAsset()?.root;
  const options = () => ({ maxError: Number($('lod-error').value) || 0.015, preserveCreases: $('lod-creases').checked, cullDetails: $('lod-cull').checked });
  const setError = value => { const sel = $('lod-error'), v = String(value); if (![...sel.options].some(o => o.value === v)) { const o = document.createElement('option'); o.value = v; o.textContent = `Custom · ${(value * 100).toFixed(1)}%`; sel.append(o); } sel.value = v; };

  function renderQuality() {
    const q = quality; if (!q) return;
    $('q-score').textContent = q.score; $('q-grade').textContent = q.grade; $('q-grade').dataset.grade = q.grade;
    $('q-bars').replaceChildren();
    for (const [k, label] of CRITERIA) {
      const v = q.criteria[k]; if (v === undefined || v === null) continue;
      const row = document.createElement('div'); row.className = 'q-row'; const l = document.createElement('span'), bar = document.createElement('i'), fill = document.createElement('b'), out = document.createElement('em');
      l.textContent = label; fill.style.width = `${Math.round(v * 100)}%`; fill.dataset.level = v >= 0.85 ? 'good' : v >= 0.6 ? 'ok' : 'bad'; out.textContent = `${Math.round(v * 100)}`; bar.append(fill); row.append(l, bar, out); $('q-bars').append(row);
    }
    const t = q.totals; $('q-facts').textContent = `${t.quadPairs.toLocaleString()} quad pairs · ${t.ngons} n-gon fans · ${t.poles} poles (${t.deformationPoles} in joints) · ${q.joints.length ? q.joints.filter(j => j.ok).length + '/' + q.joints.length + ' joints with ≥3 loops' : 'no skinned joints'}`;
    $('q-tips').textContent = q.tips.slice(0, 3).join(' ') || 'Production-ready topology for this asset type.';
  }
  function refreshQuality() {
    clearTimeout(qualityTimer);
    // Scored on the worker threads; a newer request (another LOD step, a reload) wins.
    const r0 = root(), my = ++qualityTicket;
    qualityTimer = setTimeout(async () => { if (!r0) return; try { const q = await analyzeQualityAsync(r0, pool.quality); if (my === qualityTicket && root() === r0) { quality = q; renderQuality(); } } catch (e) { console.error(e); } }, 30);
  }
  function describe(r) {
    const lines = [`Triangles ${r.before.triangles.toLocaleString()} → ${r.after.triangles.toLocaleString()} (−${Math.round(r.achieved * 100)}%) · max deviation ${(r.maxError * 100).toFixed(2)}% of size.`];
    const skinned = r.changes.filter(c => c.skinned).length, skipped = r.changes.filter(c => c.skipped), culled = r.changes.reduce((s, c) => s + (c.culledTriangles || 0), 0);
    if (skinned) lines.push(`${skinned} skinned mesh${skinned > 1 ? 'es' : ''}: weights blended, joint loops protected.`);
    if (culled) lines.push(`${culled.toLocaleString()} tris from tiny parts culled.`);
    if (r.achieved + 0.02 < r.reduction) lines.push('Error limit reached before the target: the model stays intact. Raise the limit or enable culling to go further.');
    if (r.reduction >= 0.75) lines.push('⚠ Breaking point zone: beyond ~75% the silhouette starts to collapse. Use for distant LODs only.');
    if (skipped.length) lines.push(`Skipped: ${skipped.map(c => `${c.name} (${c.skipped})`).join(', ')}.`);
    return lines.join(' ');
  }
  /** Re-runs the optimizer from the original geometry at the given reduction (0–95%). Runs are serialized; a newer
   *  slider value supersedes an older one, whose result is discarded. */
  function applyLOD(pct = Number($('lod').value)) {
    const my = ++ticket;
    $('lod').value = String(pct); $('lod-out').value = `${pct}%`; $('lod-level').textContent = levelOf(pct);
    const run = chain.then(() => runLOD(pct, my)); chain = run.catch(() => {}); return run;
  }
  async function runLOD(pct, my) {
    const r0 = root(); if (!r0 || my !== ticket) return null;
    ctx.getUndo()?.undo(); ctx.setUndo(null); lastLod = null;
    if (pct > 0) {
      $('lod-result').textContent = `Optimizing on ${pool.threads || 1} CPU thread${pool.threads === 1 ? '' : 's'} · GPU keeps rendering…`;
      const t0 = performance.now(), r = await lodRun(r0, { reduction: pct / 100, keepUndo: true, ...options() });
      if (my !== ticket || root() !== r0) { r.undo(); return null; }
      lastLod = r; ctx.setUndo(r); $('lod-result').textContent = describe(r) + ` (${Math.round(performance.now() - t0)} ms on ${pool.threads || 1} CPU threads)`; $('lod-result').classList.toggle('warn', r.reduction >= 0.75);
      message(`${levelOf(pct)} preview · ${r.after.triangles.toLocaleString()} triangles · exports use it`);
    } else { $('lod-result').textContent = 'Original geometry. Drag to reduce: flat areas go first, silhouette, hard edges, UV seams and skin-weight joints last.'; $('lod-result').classList.remove('warn'); }
    ctx.stats(); ctx.refreshTopology(); refreshQuadView(); return lastLod;
  }
  $('lod').oninput = () => { const pct = Number($('lod').value); $('lod-out').value = `${pct}%`; $('lod-level').textContent = levelOf(pct); clearTimeout(timer); timer = setTimeout(guarded(() => applyLOD(pct)), 120); };
  for (const id of ['lod-error', 'lod-creases', 'lod-cull']) $(id).onchange = guarded(() => applyLOD());
  document.querySelectorAll('[data-lod]').forEach(b => { b.onclick = guarded(() => { const level = LOD_LEVELS.find(l => l.name === b.dataset.lod); setError(Math.max(0.006, level.maxError || 0.015)); $('lod-cull').checked = !!level.cullDetails; applyLOD(Math.round((1 - level.keep) * 100)); }); });

  // Intent for the smart pass: quads only where they matter (deforming/organic/subdivision), triangles kept elsewhere.
  if (!$('topo-intent')) { const sel = document.createElement('select'); sel.id = 'topo-intent'; sel.title = 'What the mesh is for'; sel.setAttribute('aria-label', 'Topology intent'); for (const [v, l] of [['auto', 'Auto (decide per mesh)'], ['animation', 'Animation / rig'], ['subdivision', 'Subdivision (100% quads)'], ['game', 'Game-final (keep tris)'], ['print', '3D print']]) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.append(o); } $('fix-topology').before(sel); }
  function runFix(intent = $('topo-intent').value) {
    if (!root()) return; ctx.getUndo()?.commit(); ctx.setUndo(null);
    const r = smartTopology(root(), { intent, keepUndo: true }); ctx.setUndo(r);
    const lines = r.meshes.map(m => m.skipped ? `${m.name}: skipped (${m.skipped})` : `${m.name} [${m.kind}]: ${m.reason}. ${m.actions.quadCaps} quad caps, ${m.actions.flips} flips, ${m.actions.relaxed} relaxed${m.actions.allQuads ? ', split to 100% quads' : ''} · tris ${m.triangles[0]} → ${m.triangles[1]}`);
    $('lod-result').textContent = `Smart topology (${intent}): score ${r.before.score} ${r.before.grade} → ${r.after.score} ${r.after.grade}. Shape unchanged.\n` + lines.slice(0, 8).join('\n') + (lines.length > 8 ? `\n… ${lines.length - 8} more meshes` : '');
    ctx.stats(); ctx.refreshTopology(); refreshQuadView(); message(`Topology ${r.before.score} → ${r.after.score} · undo available`); return r;
  }
  $('fix-topology').onclick = guarded(runFix);

  $('lod-chain').onclick = guarded(async () => {
    if (!root()) return; const keep = Number($('lod').value), base = ctx.getProject()?.id || 'model', files = {}, report = [];
    await chain; ctx.getUndo()?.undo(); ctx.setUndo(null);
    try {
      for (const level of LOD_LEVELS) {
        let r = null; if (level.keep < 1) r = await lodRun(root(), { reduction: 1 - level.keep, keepUndo: true, maxError: level.maxError, cullDetails: !!level.cullDetails, preserveCreases: $('lod-creases').checked });
        message(`Encoding ${level.name}…`); const out = await ctx.exportAsset('glb'); files[`${base}_${level.name}.glb`] = out.data;
        report.push({ level: level.name, triangles: r ? r.after.triangles : ctx.stats().triangles, maxError: r ? r.maxError : 0, culled: r ? r.changes.reduce((s, c) => s + (c.culledTriangles || 0), 0) : 0 }); r?.undo();
      }
    } finally { await applyLOD(keep); }
    files['lod-report.json'] = strToU8(JSON.stringify({ asset: base, levels: report, note: 'LOD0 is the source. Switch by screen size, e.g. LOD1 < 50%, LOD2 < 25%, LOD3 < 10% of screen height.' }, null, 2));
    ctx.download(zipSync(files), `${base}_LODs.zip`, 'application/zip'); message(`LOD chain exported: ${report.map(l => `${l.level} ${l.triangles.toLocaleString()}`).join(' · ')}`);
    return report;
  });

  const quadButton = document.createElement('button'); quadButton.id = 'quads'; quadButton.innerHTML = '▦ <span>Quads</span>'; quadButton.title = 'Quad flow and poles'; quadButton.setAttribute('aria-pressed', 'false'); document.querySelector('.view-tools').append(quadButton);
  function refreshQuadView() { if (quadOverlay) { ctx.scene.remove(quadOverlay); quadOverlay.userData.dispose(); quadOverlay = null; } if (quadButton.getAttribute('aria-pressed') === 'true' && root()) { quadOverlay = createQuadOverlay(root()); ctx.scene.add(quadOverlay); } }
  quadButton.onclick = guarded(() => { const on = quadButton.getAttribute('aria-pressed') !== 'true'; quadButton.setAttribute('aria-pressed', String(on)); refreshQuadView(); message(on ? 'Quad view: diagonals hidden · blue N-pole (3) · orange E-pole (5) · red 6+ · magenta pole inside a joint' : 'Shaded viewport'); });

  return {
    refreshQuality, applyLOD,
    reset() { $('lod').value = '0'; $('lod-out').value = '0%'; $('lod-level').textContent = 'LOD0'; lastLod = null; refreshQuadView(); },
    installed() { this.reset(); $('lod-result').textContent = 'Drag to reduce: flat areas go first, silhouette, hard edges, UV seams and skin-weight joints last.'; refreshQuality(); },
    update() { if (quadOverlay) quadOverlay.userData.update(); },
    get quality() { return quality; },
    api: {
      lod: async (reduction, opts = {}) => { const pct = Math.round(reduction * 100); if (opts.maxError) setError(opts.maxError); if (opts.cullDetails !== undefined) $('lod-cull').checked = !!opts.cullDetails; const r = await applyLOD(pct); return r && { before: r.before.triangles, after: r.after.triangles, achieved: r.achieved, maxError: r.maxError, changes: r.changes }; },
      quality: () => analyzeQualityAsync(root(), pool.quality),
      get cpuThreads() { return pool.threads; },
      fixTopology: (intent = 'auto') => { const r = runFix(intent); return { before: r.before, after: { score: r.after.score, grade: r.after.grade }, meshes: r.meshes }; },
      smartTopology: (intent = 'auto') => { const r = runFix(intent); return { before: r.before, after: { score: r.after.score, grade: r.after.grade }, meshes: r.meshes }; },
    },
  };
}
