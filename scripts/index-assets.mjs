// Builds assets/index.json: a compact, searchable catalog of the bundled icon/texture/effect library.
import { readdir, readFile, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../assets/', import.meta.url)), library = path.join(root, 'library');
const PACKS = {
  'gvesster-icon-pack-v6': { kind: 'icon', license: 'gvesster Free Icon Pack v6: commercial use allowed, credit @gvesster optional, do not resell as an asset pack' },
  'icon-pack': { kind: 'icon', license: 'gvesster Free Icon Pack: commercial use allowed, credit @gvesster optional, do not resell as an asset pack' },
  'rhosgfx-vector-icon-pack': { kind: 'icon', license: "RhosGFX Vector Icon Pack: free for the user's own games; NOT for commissions/client work without a commercial license" },
  'ui-icon-pack-catalog': { kind: 'icon', license: 'UI Icon Pack Catalog: reference-only until rights are confirmed (Rank Icons and Keyboard Keys are RhosGFX CC0)' },
  'kek-ui-essentials': { kind: 'effect', license: 'Kek UI Essentials: no license file shipped; confirm rights before commercial release' },
  'ui-resources': { kind: 'other', license: 'UI Resources community capture: per-creator terms; keep source URL and confirm rights (see MANIFEST.csv)' },
};
const KIND_BY_FOLDER = { Backgrounds: 'background', Brushes: 'brush', Effects: 'effect', Faces: 'face', Icons: 'icon', Other: 'other', Renders: 'render', Textures: 'texture' };
const IMAGE = /\.(png|webp|jpe?g|gif|svg)$/i;
// Baked opaque backgrounds that cannot be recolored; kept on disk but never offered to recipes.
const EXCLUDED = new Set(['kek-ui-essentials/kek_universal.png']);

function parseCSV(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c; }
    else if (c === '"') quoted = true; else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full)); else if (IMAGE.test(entry.name)) out.push(full);
  }
  return out;
}
async function sniff(file) {
  const handle = await open(file, 'r'), buf = Buffer.alloc(12); await handle.read(buf, 0, 12, 0); await handle.close();
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png'; if (buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'; if (buf.toString('ascii', 0, 3) === 'GIF') return 'gif'; return 'svg';
}

const manifest = new Map();
try {
  const rows = parseCSV((await readFile(path.join(library, 'ui-resources', 'MANIFEST.csv'), 'utf8')).replace(/^﻿/, ''));
  const head = rows[0];
  for (const r of rows.slice(1)) { const o = Object.fromEntries(head.map((h, i) => [h, r[i]])); if (o.downloaded_path) manifest.set(o.downloaded_path.replace(/\\/g, '/'), o); }
} catch { /* optional */ }

const assets = [];
for (const file of await walk(library)) {
  const rel = path.relative(library, file).split(path.sep).join('/'), [pack, ...rest] = rel.split('/');
  if (!PACKS[pack] || EXCLUDED.has(rel)) continue;
  const base = rest.at(-1).replace(IMAGE, ''), folders = rest.slice(0, -1);
  let kind = PACKS[pack].kind, name = base, extra = '';
  if (pack === 'ui-resources') {
    const folder = folders[1]; if (folder === 'Sounds') continue;
    kind = KIND_BY_FOLDER[folder] ?? 'other';
    const m = manifest.get(rest.join('/')); if (m) { name = m.title || base; extra = `${m.tags} ${m.description} ${m.category}`; }
  } else if (pack === 'kek-ui-essentials') {
    kind = /stud|universal|weld|halftone|dirt|design/.test(base) ? 'texture' : 'effect';
  } else if (pack === 'icon-pack' || pack === 'gvesster-icon-pack-v6') {
    name = folders[1] ?? base;
  } else if (pack === 'rhosgfx-vector-icon-pack') {
    name = folders[1] ?? base.replace(/\s+(Outline\s+)?(64|256)$/i, '');
  } else if (pack === 'ui-icon-pack-catalog') {
    name = base.replace(/_(Sim|Glossy|Bold|Flat_\w+)$/i, '').replace(/_/g, ' ');
    if (/Frames/.test(folders[0] ?? '')) kind = 'background';
  }
  const sizeMatch = `${folders.join(' ')} ${base}`.match(/\b(64|128|256|512)(px|w)?\b/), size = sizeMatch ? Number(sizeMatch[1]) : 0;
  const words = `${name} ${folders.join(' ')} ${base} ${extra} ${kind}`.toLowerCase().replace(/[_\-./(),;]+/g, ' ').split(/\s+/).filter(Boolean);
  assets.push({ path: `library/${rel}`, pack, kind, name: name.trim(), size, outline: /outline/i.test(base), golden: /golden|gold\b/i.test(base), format: await sniff(file), search: ` ${[...new Set(words)].join(' ')} ` });
}
assets.sort((a, b) => a.path.localeCompare(b.path));
const packs = Object.fromEntries(Object.entries(PACKS).map(([id, p]) => [id, { license: p.license, count: assets.filter(a => a.pack === id).length }]));
await writeFile(path.join(root, 'index.json'), JSON.stringify({ generated: new Date().toISOString(), packs, assets }));
console.log(JSON.stringify({ assets: assets.length, packs: Object.fromEntries(Object.entries(packs).map(([k, v]) => [k, v.count])), kinds: assets.reduce((m, a) => (m[a.kind] = (m[a.kind] ?? 0) + 1, m), {}) }, null, 2));
