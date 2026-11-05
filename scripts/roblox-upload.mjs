// Upload files to the user's Roblox account with the Open Cloud key saved in Settings (codex.settings.json).
//   npm run roblox:upload -- <file> [<file> …] [--name "Display name"] [--type Decal|Model|Audio]
//   npm run roblox:upload -- --test        (checks the key and its scopes)
// Prints {file, assetId, imageId|decalId}. Uploading publishes to Roblox: agents run this only after the user agreed.
import path from 'node:path';
import { uploadAsset, introspectKey } from './roblox-cloud.mjs';
import { loadSettings } from './settings.mjs';
const args = process.argv.slice(2), take = n => { const i = args.indexOf('--' + n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
if (args.includes('--test')) { console.log(JSON.stringify(await introspectKey((await loadSettings()).roblox.apiKey), null, 1)); process.exit(0); }
const name = take('name'), type = take('type'); if (!args.length) throw new Error('Usage: npm run roblox:upload -- <file> […] [--name ..] [--type Decal|Model|Audio] | --test');
const out = []; for (const f of args) out.push({ file: f, ...(await uploadAsset({ file: path.resolve(f), name: name ?? path.basename(f, path.extname(f)), assetType: type })) });
console.log(JSON.stringify(out, null, 1));
