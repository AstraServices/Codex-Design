// Workshop settings (codex.settings.json, git-ignored, local only). The Roblox Open Cloud API key never leaves
// the server: GET returns a masked hint, the browser can only replace or clear it. Used by server.mjs and the CLIs.
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SETTINGS_FILE = path.join(root, 'codex.settings.json');

export const DEFAULT_SETTINGS = {
  roblox: { apiKey: '', creatorType: 'user', creatorId: '', uploadAssetType: 'Decal', resolveImageIds: true, askBeforeUpload: true },
  general: { language: 'tr', exportTarget: 'roblox', units: 'meters', checkUpdates: true },
  texture: { previewSize: 256, exportSize: 1024, profiles: ['roblox-surfaceappearance'], normalFormat: 'opengl', seamlessCheck: true, gpu: true },
  vfx: { quality: 'Auto', maxParticles: 400, mobileBudget: true, cullDistance: 250, defaultLightEmission: 1, preferLibrary: true },
  gfx: { titleFit: 'auto', titleScale: 1, defaultPreset: 'card', autoShowcase: true },
  studio: { pluginBridge: false },
};

const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b ?? {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return o; };

export async function loadSettings() {
  try { return merge(DEFAULT_SETTINGS, JSON.parse(await readFile(SETTINGS_FILE, 'utf8'))); } catch { return structuredClone(DEFAULT_SETTINGS); }
}
/** Settings as the browser sees them: the API key is replaced by {apiKeySet, apiKeyHint}. */
export function publicSettings(s) {
  const { apiKey, ...roblox } = s.roblox ?? {};
  return { ...s, roblox: { ...roblox, apiKeySet: !!apiKey, apiKeyHint: apiKey ? '••••' + String(apiKey).slice(-4) : '' } };
}
/** Applies a browser patch. roblox.apiKey: non-empty string replaces the key; roblox.clearApiKey: true removes it. */
export async function saveSettings(patch) {
  const cur = await loadSettings(), p = structuredClone(patch ?? {});
  const key = p.roblox?.apiKey, clear = p.roblox?.clearApiKey;
  if (p.roblox) { delete p.roblox.apiKey; delete p.roblox.clearApiKey; delete p.roblox.apiKeySet; delete p.roblox.apiKeyHint; }
  const next = merge(cur, p);
  if (typeof key === 'string' && key.trim()) next.roblox.apiKey = key.trim();
  if (clear) next.roblox.apiKey = '';
  if (next.roblox.creatorId && !/^\d{1,20}$/.test(String(next.roblox.creatorId))) throw new Error('Creator ID must be a number (your user ID or group ID)');
  if (!['user', 'group'].includes(next.roblox.creatorType)) throw new Error('creatorType must be user or group');
  await writeFile(SETTINGS_FILE + '.tmp', JSON.stringify(next, null, 2) + '\n'); await rename(SETTINGS_FILE + '.tmp', SETTINGS_FILE);
  return next;
}
