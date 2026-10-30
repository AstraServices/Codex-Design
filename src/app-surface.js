// Live Surface editor: every look parameter of the selected painted part (k.voxels / k.block / k.paint) as a control,
// the gradient stack as editable JSON, "Make paintable" for plain meshes, and "Copy code" to keep the edits in the recipe.
// Edits are live for this session (like the Highlight panel); the recipe stays the source of truth.
import { LOOK_DEFAULTS, LOOKS } from './look.js';
import { rebakeSurface, surfaceCode, initSurface } from './surface.js';

const GROUPS = [
  ['Rim', [['rim', 0, 1, 0.01], ['rimWidth', 0, 0.5, 0.005], ['rimSoftness', 0, 1, 0.05], ['rimMode', ['hsl', 'gain']], ['rimLighten', 0, 1, 0.01], ['rimSaturate', 0, 2, 0.05], ['rimHue', -180, 180, 1], ['rimGain', 0.5, 3, 0.05], ['rimLift', 0, 0.6, 0.01], ['rimColor', 'color']]],
  ['Glow', [['glow', 0, 1, 0.01], ['glowWidth', 0.01, 1, 0.01], ['glowColor', 'color'], ['emissiveRim', 0, 2, 0.05]]],
  ['Vignette', [['vignette', 0, 1, 0.01], ['vignetteStart', 0, 1, 0.01], ['vignetteEnd', 0, 1, 0.01], ['vignettePower', 0.2, 4, 0.05], ['vignetteColor', 'color']]],
  ['Shading', [['faceGradient', -0.5, 0.5, 0.01], ['ao', 0, 1, 0.01], ['aoColor', 'color'], ['grime', 0, 1, 0.01], ['speckle', 0, 0.3, 0.01], ['edgeNoise', 0, 2, 0.05]]],
  ['Grade', [['brightness', 0.3, 1.8, 0.01], ['contrast', 0.3, 2, 0.01], ['saturation', 0, 2, 0.01], ['hueShift', -180, 180, 1], ['gamma', 0.4, 2.5, 0.01], ['lift', 0, 0.6, 0.01], ['posterize', 0, 12, 1]]],
  ['Sheen', [['sheen', 0, 1, 0.01], ['sheenOffset', 0, 1, 0.01], ['sheenWidth', 0.01, 0.4, 0.005]]],
  ['Grooves', [['grooves', 0, 1, 0.01], ['grooveEvery', 0.25, 4, 0.25], ['grooveWidth', 0.01, 0.3, 0.005], ['grooveLip', 0, 1, 0.05], ['grooveDir', ['long', 'short', 'u', 'v']]]],
  ['Studs', [['studs', ['train', 'train-mixed', 'none']], ['studScale', 0.25, 4, 0.25], ['studStrength', 0, 1, 0.05]]],
];

/** ctx: {$, getAsset, message, guarded, stats} */
export function createSurfacePanel(ctx) {
  const { $, message, guarded } = ctx;
  let target = null, timer = null, snapshot = null;
  const S = () => target?.userData.codexSurface;
  const current = key => { const s = S(), look = typeof s.options.look === 'object' ? s.options.look : LOOKS[s.options.look] ?? {}; return s.options[key] ?? look[key] ?? LOOK_DEFAULTS[key] ?? (key === 'studs' ? (s.kind === 'quads' ? 'train' : 'none') : key === 'studScale' ? 1 : key === 'studStrength' ? 0.9 : undefined); };
  const apply = () => { clearTimeout(timer); timer = setTimeout(guarded(async () => { if (!target) return; const t = performance.now(); await rebakeSurface(target, ctx.getAsset().root); message(`${target.name}: surface re-baked in ${Math.round(performance.now() - t)} ms · copy the code to keep it`); }), 120); };
  function render() {
    const box = $('surface-controls'); box.replaceChildren();
    $('surface-target').textContent = target ? target.name : 'Select a part';
    $('surface-make').hidden = !target || !!S(); $('surface-actions').hidden = !S();
    if (!S()) { $('surface-gradients').value = ''; return; }
    for (const [title, fields] of GROUPS) {
      const d = document.createElement('details'); d.className = 'surface-group'; if (title === 'Rim' || title === 'Vignette') d.open = true;
      const sm = document.createElement('summary'); sm.textContent = title; d.append(sm);
      for (const [key, a, b, step] of fields) {
        const row = document.createElement('label'); row.className = 'surface-row'; const name = document.createElement('span'); name.textContent = key; row.append(name); d.append(row);
        let input; const val = current(key);
        if (Array.isArray(a)) { input = document.createElement('select'); for (const o of a) { const opt = document.createElement('option'); opt.value = opt.textContent = o; input.append(opt); } input.value = val; input.onchange = () => { S().options[key] = input.value; apply(); }; }
        else if (a === 'color') { input = document.createElement('input'); input.type = 'color'; input.value = typeof val === 'string' && val.startsWith('#') ? val : '#ffffff'; const on = document.createElement('input'); on.type = 'checkbox'; on.checked = !!val; on.title = 'use this color'; on.onchange = () => { S().options[key] = on.checked ? input.value : null; apply(); }; input.oninput = () => { if (on.checked) { S().options[key] = input.value; apply(); } }; row.append(on); }
        else { input = document.createElement('input'); input.type = 'range'; input.min = a; input.max = b; input.step = step; input.value = val ?? 0; const out = document.createElement('output'); out.textContent = input.value; input.oninput = () => { out.textContent = input.value; S().options[key] = Number(input.value); apply(); }; row.append(input, out); continue; }
        row.append(input);
      }
      box.append(d);
    }
    $('surface-gradients').value = JSON.stringify(S().gradients.filter(g => !Object.values(g).some(v => typeof v === 'function')), null, 1);
  }
  addEventListener('codex-select', e => { target = e.detail?.isMesh ? e.detail : null; snapshot = S() ? structuredCloneSafe(S()) : null; render(); });
  const structuredCloneSafe = s => ({ options: { ...s.options }, gradients: [...s.gradients] });
  $('surface-make').onclick = guarded(async () => { if (!target) return; initSurface(target); S().options.look = 'default'; snapshot = structuredCloneSafe(S()); await rebakeSurface(target, ctx.getAsset().root); render(); ctx.stats?.(); });
  $('surface-apply-gradients').onclick = guarded(async () => {
    const list = JSON.parse($('surface-gradients').value || '[]'); if (!Array.isArray(list)) throw new Error('Gradient stack must be a JSON array of gradient objects');
    const fnGrads = S().gradients.filter(g => Object.values(g).some(v => typeof v === 'function')); S().gradients = [...fnGrads, ...list]; await rebakeSurface(target, ctx.getAsset().root); message(`${target.name}: ${list.length} gradient(s) applied`);
  });
  $('surface-reset').onclick = guarded(async () => { if (!snapshot || !S()) return; S().options = { ...snapshot.options }; S().gradients = [...snapshot.gradients]; await rebakeSurface(target, ctx.getAsset().root); render(); });
  $('surface-copy').onclick = guarded(async () => { const code = surfaceCode(target); await navigator.clipboard?.writeText(code); message('Surface code copied: paste it at the end of build(k)'); });
  render();
  return { api: {
    surface: name => { const m = ctx.getAsset().root.getObjectByName(name); return m?.userData.codexSurface ? { options: { ...m.userData.codexSurface.options }, gradients: m.userData.codexSurface.gradients } : null; },
    async setSurface(name, options = {}, gradients) { const m = ctx.getAsset().root.getObjectByName(name); if (!m) throw new Error(`No object named ${name}`); if (!m.userData.codexSurface) { initSurface(m); m.userData.codexSurface.options.look = 'default'; } Object.assign(m.userData.codexSurface.options, options); if (gradients) m.userData.codexSurface.gradients = gradients; await rebakeSurface(m, ctx.getAsset().root); return surfaceCode(m); },
  } };
}
