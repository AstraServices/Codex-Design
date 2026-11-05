// Roblox Open Cloud: API key check and asset upload (Assets API v1). Used by server.mjs (Settings + "Upload to Roblox")
// and by `npm run roblox:upload`. Uploading publishes files to the user's Roblox account, so every caller asks first.
//  - Images go up as Decal (Open Cloud has no plain Image type). The operation returns the DECAL id; ParticleEmitter /
//    Beam / Trail / SurfaceAppearance need the IMAGE id behind it. resolveImageId() tries the public asset delivery
//    endpoint; when that is refused the id must be resolved in Studio (InsertService:LoadAsset(decalId).Decal.Texture),
//    which the generated CodexVFX importer and the Studio MCP flow do. Never write a decal id into a Texture property.
//  - Models (.rbxm / .fbx / .glb) go up as Model.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSettings } from './settings.mjs';

const API = 'https://apis.roblox.com';
const TYPES = { '.png': ['Decal', 'image/png'], '.jpg': ['Decal', 'image/jpeg'], '.jpeg': ['Decal', 'image/jpeg'], '.bmp': ['Decal', 'image/bmp'], '.tga': ['Decal', 'image/tga'],
  '.rbxm': ['Model', 'model/x-rbxm'], '.fbx': ['Model', 'model/fbx'], '.glb': ['Model', 'model/gltf-binary'], '.mp3': ['Audio', 'audio/mpeg'], '.ogg': ['Audio', 'audio/ogg'] };

export async function introspectKey(apiKey) {
  if (!apiKey) return { ok: false, error: 'No API key saved. Settings → Roblox → paste the key from create.roblox.com/dashboard/credentials.' };
  const r = await fetch(`${API}/api-keys/v1/introspect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }), signal: AbortSignal.timeout(15000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status, error: body.message || body.errors?.[0]?.message || `Roblox answered ${r.status}` };
  const scopes = (body.scopes ?? []).map(s => `${s.name}:${(s.operations ?? []).join(',')}`);
  const canUpload = (body.scopes ?? []).some(s => s.name === 'asset' && (s.operations ?? []).some(o => /write/.test(o)));
  return { ok: !body.expired && body.enabled !== false, name: body.name, enabled: body.enabled, expired: body.expired, scopes, canUpload, authorizedUserId: body.authorizedUserId ?? null };
}

async function poll(apiKey, operationId, { tries = 30, wait = 1500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`${API}/assets/v1/operations/${operationId}`, { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(15000) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.message || `Operation check failed (${r.status})`);
    if (body.done) { if (body.error) throw new Error(body.error.message || 'Upload rejected by Roblox'); return body.response ?? {}; }
    await new Promise(res => setTimeout(res, wait));
  }
  throw new Error(`Roblox is still processing operation ${operationId}; check it later in the Creator Dashboard`);
}

/** Best effort: decal id → image id via the public asset delivery XML. Returns null when Roblox refuses. */
export async function resolveImageId(decalId) {
  try {
    const r = await fetch(`https://assetdelivery.roblox.com/v1/asset/?id=${decalId}`, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const m = (await r.text()).match(/<url>[^<]*?(?:id=|rbxassetid:\/\/)(\d+)<\/url>/i);
    return m && m[1] !== String(decalId) ? m[1] : null;
  } catch { return null; }
}

/** Upload one file. {file (path) | bytes, name, description, assetType?} → {assetId, assetType, imageId?, needsStudioResolve} */
export async function uploadAsset({ file, bytes, fileName, name, description = 'Uploaded by Codex Design', assetType }) {
  const s = await loadSettings(), { apiKey, creatorType, creatorId } = s.roblox;
  if (!apiKey) throw new Error('No Roblox API key. Open Settings → Roblox and paste an Open Cloud key with asset:read + asset:write.');
  if (!creatorId) throw new Error('No creator ID. Settings → Roblox → your user ID (or group ID).');
  const ext = path.extname(fileName ?? file ?? '').toLowerCase(), type = TYPES[ext];
  if (!type) throw new Error(`Unsupported file type ${ext || '(none)'} for Roblox upload`);
  const data = bytes ?? await readFile(file), kind = assetType ?? type[0];
  if (data.length > 20_000_000) throw new Error('File too large for upload (20 MB)');
  const request = { assetType: kind, displayName: String(name ?? path.basename(fileName ?? file, ext)).slice(0, 50), description: String(description).slice(0, 1000),
    creationContext: { creator: creatorType === 'group' ? { groupId: String(creatorId) } : { userId: String(creatorId) } } };
  const form = new FormData();
  form.append('request', JSON.stringify(request));
  form.append('fileContent', new Blob([data], { type: type[1] }), path.basename(fileName ?? file));
  const r = await fetch(`${API}/assets/v1/assets`, { method: 'POST', headers: { 'x-api-key': apiKey }, body: form, signal: AbortSignal.timeout(120000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.message || body.errors?.[0]?.message || `Upload failed (${r.status})`);
  const op = body.operationId ?? String(body.path ?? '').split('/').pop();
  const res = body.done ? body.response : await poll(apiKey, op);
  const assetId = String(res.assetId ?? res.asset?.assetId ?? '');
  if (!assetId) throw new Error('Roblox finished the upload but returned no asset id');
  const out = { assetId, assetType: kind, operationId: op, displayName: request.displayName };
  if (kind === 'Decal') {
    out.decalId = assetId; out.imageId = s.roblox.resolveImageIds ? await resolveImageId(assetId) : null;
    out.needsStudioResolve = !out.imageId; // resolve in Studio: InsertService:LoadAsset(decalId):FindFirstChildWhichIsA('Decal').Texture
  }
  return out;
}
