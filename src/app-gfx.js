// GFX Studio: presets, text, layout/background/shadow, watermark (saved to gfx.config.json, shared with `npm run gfx`),
// live preview, PNG download, and animated MP4/GIF (animation choreography + turntable, encoded by ffmpeg on the server).
// API: window.codexDesign.gfx(options) → {base64,width,height}; gfxVideo(options) → {file,frames,bytes}; gfxPresets; gfxConfig().
import { gfx, GFX_PRESETS, WATERMARK_DEFAULTS, loadWatermarkImage, measureFrameLock } from './gfx.js';

const ANGLE_DEG = { 'three-quarter': [35, 22], iso: [45, 30], front: [0, 6], side: [90, 6], back: [180, 12], top: [30, 58], low: [30, -8], hero: [25, 10] };

/** ctx: {$, renderer, scene, lighting, getAsset, getProject, message, guarded, download, choreography} */
export function createGfxPanel(ctx) {
  const { $, renderer, scene, lighting, message, guarded, download } = ctx;
  let lastBlob = null, config = { watermark: null }, logo = null, bgPhoto = null, liveTimer = null, liveBusy = false;
  for (const [id, p] of Object.entries(GFX_PRESETS)) { const opt = document.createElement('option'); opt.value = id; opt.textContent = `${p.label} · ${p.width}×${p.height}`; $('gfx-preset').append(opt); }
  const context = () => { const root = ctx.getAsset()?.root; return { renderer, scene, lighting, root, hide: scene.children.filter(c => c !== root && !c.isLight && c.visible) }; };
  const loadConfig = (async () => { try { config = await (await fetch('/api/gfx-config')).json(); } catch { config = {}; } if (config.watermark?.imageSrc) logo = await loadWatermarkImage(config.watermark.imageSrc).catch(() => null); return config; })();
  /** Defaults: shared config (watermark) < project manifest "gfx" < explicit options. watermark:null disables it. */
  async function merged(options = {}) {
    await loadConfig;
    const project = ctx.getProject() ?? {}, o = { ...(config.defaults ?? {}), ...(project.gfx ?? {}), ...options };
    if (!('watermark' in options)) o.watermark = project.gfx?.watermark ?? (config.watermark?.enabled ? { ...config.watermark, image: logo } : null);
    if (o.title === undefined && !['icon', 'icon-minimal', 'transparent', 'sticker'].includes(o.preset)) o.title = project.name?.split(' / ')[0];
    return o;
  }
  const render = async options => gfx(context(), await merged(options));
  const preset = () => GFX_PRESETS[$('gfx-preset').value];
  // ---------- form ----------
  const out = id => document.querySelector(`output[data-for="${id}"]`);
  const setRange = (id, v) => { $(id).value = v; if (out(id)) out(id).textContent = $(id).value; };
  function syncPreset() {
    const p = preset(); $('gfx-angle').value = typeof p.angle === 'string' ? p.angle : 'three-quarter'; $('gfx-size').textContent = `${p.width}×${p.height}`;
    setRange('gfx-fill', p.fill ?? 0.6); setRange('gfx-offsetX', p.offsetX ?? 0); setRange('gfx-offsetY', p.offsetY ?? 0); setRange('gfx-vignette', p.vignette ?? 0);
    setRange('gfx-rays', p.rays?.alpha ?? 0); setRange('gfx-bokeh', p.bokeh ?? 0); $('gfx-bgtype').value = ''; $('gfx-shadow').value = '';
    const cols = Array.isArray(p.bg?.colors) ? p.bg.colors : ['#f6f9fb', '#c3d0da']; ['gfx-bg0', 'gfx-bg1', 'gfx-bg2'].forEach((id, i) => { $(id).value = cols[Math.min(i, cols.length - 1)]; });
  }
  for (const r of document.querySelectorAll('#gfx-dialog input[type=range]')) if (out(r.id)) r.addEventListener('input', () => { out(r.id).textContent = r.value; });
  const wmFields = ['opacity', 'size', 'rotation', 'imagescale'], syncWm = () => { for (const f of wmFields) $(`wm-${f}-v`).textContent = $(`wm-${f}`).value; };
  for (const f of wmFields) $(`wm-${f}`).addEventListener('input', syncWm);
  function readWatermark() { return { enabled: $('wm-on').checked, text: $('wm-text').value, position: $('wm-position').value, opacity: +$('wm-opacity').value, size: +$('wm-size').value, rotation: +$('wm-rotation').value, color: $('wm-color').value, stroke: $('wm-stroke').checked ? 'rgba(0,0,0,0.35)' : null, tile: $('wm-tile').checked, imageScale: +$('wm-imagescale').value, imageSrc: config.watermark?.imageSrc ?? null }; }
  function writeWatermark(w = {}) { const v = { ...WATERMARK_DEFAULTS, ...w }; $('wm-on').checked = !!w.enabled; $('wm-text').value = v.text ?? ''; $('wm-position').value = v.position; $('wm-opacity').value = v.opacity; $('wm-size').value = v.size; $('wm-rotation').value = v.rotation; $('wm-color').value = v.color; $('wm-stroke').checked = !!v.stroke; $('wm-tile').checked = !!v.tile; $('wm-imagescale').value = v.imageScale; syncWm(); }
  function formOptions() {
    const p = preset(), o = { preset: $('gfx-preset').value, angle: $('gfx-angle').value, accent: $('gfx-accent').value, rarity: $('gfx-rarity').value };
    for (const f of ['title', 'tag', 'subtitle', 'footer']) o[f] = $('gfx-' + f).value.trim();
    o.fill = +$('gfx-fill').value; o.offsetX = +$('gfx-offsetX').value; o.offsetY = +$('gfx-offsetY').value; o.vignette = +$('gfx-vignette').value; o.bokeh = +$('gfx-bokeh').value;
    const rays = +$('gfx-rays').value; o.rays = rays ? { ...(p.rays ?? { count: 20 }), alpha: rays } : null;
    if ($('gfx-bgtype').value) o.bg = { type: $('gfx-bgtype').value, colors: $('gfx-bgtype').value === 'solid' ? [$('gfx-bg0').value] : [$('gfx-bg0').value, $('gfx-bg1').value, $('gfx-bg2').value] };
    const sh = $('gfx-shadow').value; if (sh) Object.assign(o, { floatShadow: sh === 'float' ? 0.34 : 0, float: sh === 'float' ? (p.float ?? 0.06) : 0, dropShadow: sh === 'drop' ? 0.35 : 0, hardShadow: sh === 'hard' ? 0.35 : 0 });
    if ($('gfx-outline').checked) o.outline = '#ffffff';
    if (bgPhoto && $('bg-photo-on').checked) o.bgImage = { image: bgPhoto, fit: $('bg-photo-fit').value, blur: +$('bg-photo-blur').value, darken: +$('bg-photo-darken').value, zoom: +$('bg-photo-zoom').value };
    const w = readWatermark(); o.watermark = w.enabled ? { ...w, image: logo } : null;
    return o;
  }
  const show = async canvas => { lastBlob = await new Promise(r => canvas.toBlob(r, 'image/png')); const old = $('gfx-image').src; $('gfx-image').src = URL.createObjectURL(lastBlob); if (old.startsWith('blob:')) URL.revokeObjectURL(old); $('gfx-download').disabled = false; };
  // Live preview: half resolution, debounced, never overlapping.
  function live() { clearTimeout(liveTimer); liveTimer = setTimeout(async () => { if (liveBusy || !$('gfx-dialog').open) return; liveBusy = true; try { const o = formOptions(), p = GFX_PRESETS[o.preset]; await show(await render({ ...o, width: Math.round(p.width / 2), height: Math.round(p.height / 2) })); $('gfx-live-note').textContent = 'Live preview (half size). Render full size to download.'; } catch (e) { $('gfx-live-note').textContent = e.message; } finally { liveBusy = false; } }, 160); }
  $('gfx-dialog').addEventListener('input', e => { if (!e.target.closest('#vid-clips') && !e.target.id?.startsWith('vid-')) live(); });
  $('gfx-dialog').addEventListener('change', e => { if (e.target.id === 'gfx-preset') syncPreset(); if (!e.target.id?.startsWith('vid-')) live(); });
  $('wm-image').onchange = guarded(async () => {
    const file = $('wm-image').files?.[0]; if (!file) return; if (file.size > 2_000_000) throw new Error('Logo must be under 2 MB');
    const src = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
    logo = await loadWatermarkImage(src); config.watermark = { ...readWatermark(), imageSrc: src, enabled: true }; $('wm-on').checked = true; message('Logo loaded · Save as default to keep it'); live();
  });
  $('bg-photo').onchange = guarded(async () => { const file = $('bg-photo').files?.[0]; if (!file) return; if (file.size > 12_000_000) throw new Error('Background photo must be under 12 MB'); const src = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); }); bgPhoto = await loadWatermarkImage(src); $('bg-photo-on').checked = true; live(); });
  $('wm-clear-image').onclick = () => { logo = null; if (config.watermark) config.watermark.imageSrc = null; $('wm-image').value = ''; live(); };
  $('wm-save').onclick = guarded(async () => { config.watermark = readWatermark(); const r = await fetch('/api/gfx-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) }); if (!r.ok) throw new Error((await r.json()).error || 'Cannot save GFX config'); message('Watermark saved as default (site + npm run gfx)'); });
  function renderClipList() {
    const box = $('vid-clips'); box.replaceChildren(); const clips = ctx.getAsset()?.clips ?? [];
    if (!clips.length) { box.textContent = 'This model has no animation clips (turntable still works).'; return; }
    clips.forEach((c, i) => { const l = document.createElement('label'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = c.name; cb.checked = i === 0; l.append(cb, `${c.name} (${c.duration.toFixed(1)}s)`); box.append(l); });
  }
  function open() {
    loadConfig.then(() => {
      const g = ctx.getProject()?.gfx ?? {};
      for (const f of ['title', 'tag', 'subtitle', 'footer']) $('gfx-' + f).value = g[f] ?? (f === 'title' ? ctx.getProject()?.name?.split(' / ')[0] ?? '' : '');
      if (g.preset && GFX_PRESETS[g.preset]) $('gfx-preset').value = g.preset; writeWatermark(config.watermark ?? {}); syncPreset(); renderClipList(); $('gfx-dialog').showModal(); live();
    });
  }
  $('gfx-open').onclick = open; $('gfx-header').onclick = open;
  $('gfx-render').onclick = guarded(async () => { const canvas = await render(formOptions()); await show(canvas); message(`GFX rendered · ${canvas.width}×${canvas.height}`); });
  $('gfx-all').onclick = guarded(async () => { const base = formOptions(), id = ctx.getProject()?.id || 'model'; for (const p of Object.keys(GFX_PRESETS)) { const P = GFX_PRESETS[p]; const canvas = await render({ ...base, preset: p, angle: P.angle, fill: P.fill, offsetX: P.offsetX, offsetY: P.offsetY, vignette: P.vignette, rays: P.rays, bokeh: P.bokeh }); await show(canvas); download(lastBlob, `${id}.gfx-${p}.png`, 'image/png'); } message(`Rendered ${Object.keys(GFX_PRESETS).length} GFX presets`); });
  $('gfx-download').onclick = () => { if (lastBlob) download(lastBlob, `${ctx.getProject()?.id || 'model'}.gfx-${$('gfx-preset').value}.png`, 'image/png'); };
  $('vid-render').onclick = guarded(async () => {
    const mode = $('vid-mode').value, picked = [...document.querySelectorAll('#vid-clips input:checked')].map(c => c.value);
    const animation = mode === 'none' ? null : { mode: mode === 'all' ? 'sequence' : mode, clips: mode === 'all' ? 'all' : picked, crossfade: +$('vid-crossfade').value, speed: +$('vid-speed').value, loops: +$('vid-loops').value, seamless: $('vid-seamless').checked };
    const r = await gfxVideo({ ...formOptions(), video: { format: $('vid-format').value, fps: +$('vid-fps').value, duration: +$('vid-duration').value || undefined, width: +$('vid-width').value || undefined, turntable: +$('vid-turn').value }, animation }, s => { $('vid-status').textContent = s; });
    $('vid-status').textContent = `Saved ${r.file} · ${r.frames} frames · ${(r.bytes / 1e6).toFixed(1)} MB`;
    const blob = await (await fetch('/' + r.file)).blob(); download(blob, r.file.split('/').pop(), blob.type);
  });
  addEventListener('keydown', e => { if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) && !$('gfx-dialog').open) open(); });

  /** Animated GFX. options = GFX options + video:{format:'mp4'|'gif', fps, duration, width, turntable (deg), anchor (default true)} + animation:{clips, mode, speed, crossfade, loops, weights} | null. */
  async function gfxVideo(options = {}, progress = () => {}) {
    const v = { format: 'mp4', fps: 30, turntable: 0, ...options.video }, o = await merged({ ...options, video: undefined, animation: undefined });
    const plan = options.animation === null || options.animation === undefined && !(ctx.getAsset()?.clips?.length) ? null : ctx.choreography(options.animation ?? {});
    const duration = v.duration ?? plan?.duration ?? (v.turntable ? 4 : 3), frames = Math.max(1, Math.round(duration * v.fps));
    const base = Array.isArray(o.angle) ? o.angle : ANGLE_DEG[o.angle ?? GFX_PRESETS[o.preset ?? 'card'].angle] ?? ANGLE_DEG['three-quarter'];
    const jr = await fetch('/api/video', { method: 'POST' }); if (!jr.ok) throw new Error(`Video API unavailable (${jr.status}): restart the workshop server (npm start) so it loads the new routes`);
    // Anchor: measure every sampled pose/angle once, then lock camera + crop so nothing slides during the video.
    const angleAt = i => [base[0] + v.turntable * i / frames, base[1]], P = GFX_PRESETS[o.preset ?? 'card'], dims = { ...o, width: o.width ?? P.width, height: o.height ?? P.height };
    const samples = Array.from({ length: Math.min(frames, 24) }, (_, j) => { const i = Math.floor(j * frames / Math.min(frames, 24)); return { pose: plan ? () => plan.apply(i / v.fps) : null, angle: angleAt(i) }; });
    if (v.anchor !== false) o.frameLock = measureFrameLock(context(), dims, samples);
    const job = await jr.json(), name = `${ctx.getProject()?.id || 'model'}.gfx-${o.preset ?? 'card'}`;
    try {
      for (let i = 0; i < frames; i++) {
        const t = i / v.fps; plan?.apply(t);
        const canvas = await gfx(context(), { ...o, angle: angleAt(i) });
        const blob = await new Promise(r => canvas.toBlob(r, v.format === 'gif' ? 'image/png' : 'image/jpeg', 0.95));
        const res = await fetch(`/api/video/${job.id}/frame/${i}`, { method: 'PUT', body: blob }); if (!res.ok) throw new Error('Frame upload failed');
        if (i % 5 === 0) progress(`Rendering frame ${i + 1}/${frames}…`);
      }
    } finally { plan?.restore(); }
    progress('Encoding with ffmpeg…');
    const res = await fetch(`/api/video/${job.id}/encode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: v.format, fps: v.fps, name, width: v.width ?? (v.format === 'gif' ? Math.min(720, o.width ?? GFX_PRESETS[o.preset ?? 'card'].width) : 0) }) });
    const r = await res.json(); if (!res.ok) throw new Error(r.error); return r;
  }
  return { api: {
    gfxPresets: Object.keys(GFX_PRESETS),
    gfxConfig: async () => { await loadConfig; return config; },
    async gfx(options = {}) { const canvas = await render(options), url = canvas.toDataURL('image/png'); return { base64: url.slice(url.indexOf(',') + 1), width: canvas.width, height: canvas.height }; },
    gfxVideo: options => gfxVideo(options),
    animationPlan: plan => { const p = ctx.choreography(plan); p.restore(); return { duration: p.duration, mode: p.mode, clips: p.clips }; },
  } };
}
