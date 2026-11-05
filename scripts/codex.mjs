// Codex Design SDK command line — lets an AI trigger the studios by running code, no UI needed (the UI still shows
// everything: files land in textures/, vfx/, projects/, exports/ and the open pages reload live).
//   npm run codex -- run <script.mjs> [args…]        script: export default async (cd, args) => { … }
//   npm run codex -- call texture.export '<json args array or object>'
//   npm run codex -- help                           API overview
// Output is JSON on stdout. See docs/API.md.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCodex } from '../src/sdk/codex.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const cd = await createCodex({ log: m => process.stderr.write(m + '\n') });
const print = v => console.log(JSON.stringify(v, (k, x) => x instanceof Uint8Array || x instanceof Float32Array ? `<${x.constructor.name} ${x.length}>` : x, 1));
try {
  if (!cmd || cmd === 'help') {
    const api = {}; for (const [area, v] of Object.entries(cd)) if (v && typeof v === 'object') api[area] = Object.keys(v).filter(k => !k.startsWith('_'));
    print({ usage: ['npm run codex -- run <script.mjs>', 'npm run codex -- call <area>.<op> [json]'], api, docs: 'docs/API.md' });
  } else if (cmd === 'run') {
    if (!rest[0]) throw new Error('Usage: npm run codex -- run <script.mjs>');
    const mod = await import(pathToFileURL(path.resolve(rest[0])).href), fn = mod.default ?? mod.run;
    if (typeof fn !== 'function') throw new Error('The script must `export default async (cd, args) => { … }`');
    const result = await fn(cd, rest.slice(1)); if (result !== undefined) print(result);
  } else if (cmd === 'call') {
    const [area, op] = String(rest[0] ?? '').split('.'), fn = cd[area]?.[op];
    if (typeof fn !== 'function') throw new Error(`Unknown call ${rest[0]}; try: npm run codex -- help`);
    const parsed = rest[1] ? JSON.parse(rest[1]) : [], args = Array.isArray(parsed) ? parsed : [parsed];
    print(await fn(...args));
  } else throw new Error(`Unknown command ${cmd}; try: npm run codex -- help`);
} catch (e) { console.error(e.stack ?? e.message); process.exitCode = 1; }
finally { await cd.close(); }
