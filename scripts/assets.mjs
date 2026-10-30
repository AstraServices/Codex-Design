// Compact asset-library lookup for Codex: npm run assets -- "gold coin" [--kind icon] [--limit 8] | --studs | --materials | --packs
import { findAssets, assetIndex, LIBRARY_STUDS, ROBLOX_MATERIALS } from '../src/textures.js';
const args = process.argv.slice(2), flag = name => { const i = args.indexOf(name); if (i === -1) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
if (args.includes('--studs')) { for (const [k, v] of Object.entries(LIBRARY_STUDS)) console.log(`${k.padEnd(14)} ${v.studs.join('x').padEnd(6)} ${v.note}  (${v.src})`); console.log('procedural     studs | inlet | smooth'); process.exit(0); }
if (args.includes('--materials')) { console.log(ROBLOX_MATERIALS.join(', ')); process.exit(0); }
const index = await assetIndex();
if (args.includes('--packs')) { for (const [k, v] of Object.entries(index.packs)) console.log(`${k} (${v.count}): ${v.license}`); process.exit(0); }
const kind = flag('--kind'), pack = flag('--pack'), limit = Number(flag('--limit') ?? 10), query = args.join(' ').trim();
if (!query) throw new Error('Usage: npm run assets -- "<query>" [--kind icon|texture|effect|background|render|brush|face|other] [--pack id] [--limit n] | --studs | --materials | --packs');
const hits = await findAssets(query, { kind, pack, limit });
if (!hits.length) console.log('No matches. Try fewer or simpler words.');
for (const h of hits) console.log(`${h.path}  [${h.kind}${h.size ? ' ' + h.size : ''}${h.format !== 'png' ? ' ' + h.format : ''}]`);
const packs = [...new Set(hits.map(h => h.pack))];
for (const p of packs) console.log(`license ${p}: ${index.packs[p].license}`);
