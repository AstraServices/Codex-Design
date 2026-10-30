// GFX renders: npm run gfx -- <slug> [--preset <name>|all|--list] [--title "Swing Set"] [--tag NEW] [--subtitle ".."] [--footer ".."]
//   [--angle three-quarter|iso|hero|front|side|back|top|low] [--accent #2f7d9a] [--rarity legendary] [--width 1024 --height 1024]
//   [--outline #ffffff] [--light studio]
//   Watermark (defaults come from gfx.config.json, saved by the workshop's GFX dialog):
//   [--watermark "© Studio"] [--wm-position bottom-right] [--wm-opacity 0.35] [--wm-size 0.03] [--wm-color #fff] [--wm-rotation 0]
//   [--wm-tile] [--wm-image logo.png] [--wm-image-scale 0.08] [--no-watermark]
//   Animated: [--video mp4|gif] [--fps 30] [--duration 4] [--turntable 360] [--video-width 720]
//   [--clips "Run,Attack" | --clips all] [--mode sequence|together] [--crossfade 0.25] [--speed 1] [--loops 1] [--weights 1,0.5] [--no-seamless] [--no-animation]
//   Background photo: [--bg-image photo.jpg --bg-fit cover|contain --bg-blur 8 --bg-darken 0.3 --bg-zoom 1]
import { launchBrowser } from './browser.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2), opts = {};
const take = name => { const i = args.indexOf('--' + name); if (i === -1) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = name => { const i = args.indexOf('--' + name); if (i === -1) return false; args.splice(i, 1); return true; };
if (flag('list')) { const { GFX_PRESETS } = await import('../src/gfx.js').catch(() => ({})); if (GFX_PRESETS) for (const [k, p] of Object.entries(GFX_PRESETS)) console.log(`${k.padEnd(18)} ${p.label} · ${p.width}×${p.height}`); process.exit(0); }
for (const f of ['preset', 'title', 'tag', 'subtitle', 'footer', 'angle', 'accent', 'outline', 'rarity']) { const v = take(f); if (v !== undefined) opts[f] = v; }
for (const f of ['width', 'height']) { const v = take(f); if (v !== undefined) opts[f] = Number(v); }
const light = take('light');
// Background photo: --bg-image photo.jpg [--bg-fit cover|contain] [--bg-blur 8] [--bg-darken 0.3] [--bg-zoom 1]
const bgImagePath = take('bg-image');
if (bgImagePath) { const bytes = await readFile(bgImagePath), ext = path.extname(bgImagePath).slice(1).toLowerCase(); opts.bgImage = { src: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${bytes.toString('base64')}`, fit: take('bg-fit') ?? 'cover', blur: Number(take('bg-blur') ?? 0), darken: Number(take('bg-darken') ?? 0), zoom: Number(take('bg-zoom') ?? 1) }; }
const videoFormat = take('video'), video = videoFormat ? { format: videoFormat } : null;
if (video) { for (const [f, k] of [['fps', 'fps'], ['duration', 'duration'], ['turntable', 'turntable'], ['video-width', 'width']]) { const v = take(f); if (v !== undefined) video[k] = Number(v); } }
const clipsArg = take('clips'), animation = flag('no-animation') ? null : clipsArg || args.includes('--mode') ? { clips: clipsArg === 'all' || !clipsArg ? 'all' : clipsArg.split(',').map(s => s.trim()) } : undefined;
if (animation) { if (flag('no-seamless')) animation.seamless = false; const m = take('mode'); if (m) animation.mode = m; for (const f of ['crossfade', 'speed', 'loops']) { const v = take(f); if (v !== undefined) animation[f] = Number(v); } const w = take('weights'); if (w) animation.weights = w.split(',').map(Number); }
const wm = {}, wmText = take('watermark'), wmImage = take('wm-image');
for (const [flagName, key, num] of [['wm-position', 'position'], ['wm-opacity', 'opacity', 1], ['wm-size', 'size', 1], ['wm-color', 'color'], ['wm-rotation', 'rotation', 1], ['wm-image-scale', 'imageScale', 1]]) { const v = take(flagName); if (v !== undefined) wm[key] = num ? Number(v) : v; }
if (flag('wm-tile')) wm.tile = true;
if (wmText !== undefined) wm.text = wmText;
if (wmImage) { const bytes = await readFile(wmImage), ext = path.extname(wmImage).slice(1).toLowerCase(); wm.imageSrc = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${bytes.toString('base64')}`; }
if (flag('no-watermark')) opts.watermark = null;
else if (Object.keys(wm).length) {
  let saved = {}; try { saved = JSON.parse(await readFile(new URL('../gfx.config.json', import.meta.url), 'utf8')).watermark ?? {}; } catch {}
  opts.watermark = { ...saved, ...wm, enabled: true };
}
const id = args[0]; if (!/^[a-z][a-z0-9-]{0,63}$/.test(id || '')) throw new Error('Usage: npm run gfx -- <slug> [--preset <name>|all] [--title ..] [--watermark ".."] (see --list)');
const url = process.env.CODEX_DESIGN_URL || 'http://127.0.0.1:4173';
try { const r = await fetch(url + '/api/health'); if (!r.ok) throw new Error(); } catch { throw new Error('Start the workshop first: npm start (or npm run preview -- <slug>)'); }
const { browser } = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${url}/?project=${id}${light ? `&light=${light}` : ''}`); await page.waitForFunction(() => window.codexDesign?.ready, { timeout: 60000 });
  if (await page.locator('.project.active').getAttribute('data-id') !== id) throw new Error(`Project not found: ${id}`);
  await page.evaluate(() => window.codexDesign.setTime(0));
  const presets = opts.preset === 'all' ? await page.evaluate(() => window.codexDesign.gfxPresets) : [opts.preset ?? 'card'], out = fileURLToPath(new URL('../exports/', import.meta.url)), files = [];
  await mkdir(out, { recursive: true });
  for (const preset of presets) {
    if (video) { const r = await page.evaluate(o => window.codexDesign.gfxVideo(o), { ...opts, preset, video, ...(animation !== undefined ? { animation } : {}) }); files.push({ preset, file: path.join(out, path.basename(r.file)), frames: r.frames, bytes: r.bytes }); continue; }
    const r = await page.evaluate(o => window.codexDesign.gfx(o), { ...opts, preset }); const file = `${out}${id}.gfx-${preset}.png`; await writeFile(file, Buffer.from(r.base64, 'base64')); files.push({ preset, file, width: r.width, height: r.height });
  }
  console.log(JSON.stringify({ files, errors }, null, 2)); if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
