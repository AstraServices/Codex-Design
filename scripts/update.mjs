// Update check: compares version.txt with the copy on GitHub. The workshop page asks the user before
// applyUpdate() downloads the main branch ZIP to the OS temp folder (never Downloads), copies it over this
// install and keeps user data. Skipped for git checkouts (development copies) and when CODEX_NO_UPDATE=1.
import { readFile, writeFile, mkdir, rm, cp, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = 'AstraServices/Codex-Design';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/version.txt`;
const ZIP = `https://codeload.github.com/${REPO}/zip/refs/heads/main`;
// Never overwritten: user models, settings, outputs and installed packages.
const KEEP = new Set(['.git', 'node_modules', 'projects', 'exports', 'work', 'outputs', 'test-results', 'workspace.json', 'gfx.config.json', 'install.json']);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const parse = v => String(v).trim().replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
export function newer(remote, local) {
  const a = parse(remote), b = parse(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}
export const localVersion = async () => (await readFile(path.join(root, 'version.txt'), 'utf8').catch(() => '0.0.0')).trim();

async function exists(p) { try { await stat(p); return true; } catch { return false; } }

// Copies the new skill file into every agent skill folder recorded by install.bat.
async function refreshSkills() {
  const info = JSON.parse(await readFile(path.join(root, 'install.json'), 'utf8').catch(() => '{}'));
  const skill = (await readFile(path.join(root, 'skill', 'SKILL.md'), 'utf8')).replaceAll('C:/Users/astra/Documents/CodexDesign', root.split(path.sep).join('/'));
  for (const dir of info.skills || []) { await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'SKILL.md'), skill); }
}

// Returns {local, remote, available}; never downloads anything.
export async function checkForUpdate({ log = console.log } = {}) {
  const local = await localVersion();
  if (process.env.CODEX_NO_UPDATE === '1' || await exists(path.join(root, '.git'))) return { local, remote: null, available: false, skipped: true };
  try {
    const r = await fetch(RAW, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(r.status);
    const remote = (await r.text()).trim();
    const available = newer(remote, local);
    log(available ? `[update] New version ${remote} available (installed ${local}).` : `[update] Up to date (${local}).`);
    return { local, remote, available };
  } catch (e) { log(`[update] Version check failed (${e.message}).`); return { local, remote: null, available: false }; }
}

// Downloads and installs the GitHub version. Returns true when files were updated (the caller restarts).
export async function applyUpdate({ log = console.log } = {}) {
  const { local, remote, available } = await checkForUpdate({ log });
  if (!available) return false;
  log(`[update] Downloading ${remote}...`);
  const work = path.join(tmpdir(), `codex-design-update-${Date.now()}`);
  try {
    await mkdir(work, { recursive: true });
    const r = await fetch(ZIP, { signal: AbortSignal.timeout(600_000) });
    if (!r.ok) throw new Error(`download ${r.status}`);
    await writeFile(path.join(work, 'main.zip'), Buffer.from(await r.arrayBuffer()));
    const tar = spawnSync('tar', ['-xf', 'main.zip'], { cwd: work, stdio: 'inherit' });
    if (tar.status !== 0) throw new Error('could not extract ZIP');
    const src = path.join(work, (await readdir(work, { withFileTypes: true })).find(d => d.isDirectory()).name);
    const oldPkg = await readFile(path.join(root, 'package.json'), 'utf8');
    for (const name of await readdir(src)) if (!KEEP.has(name)) await cp(path.join(src, name), path.join(root, name), { recursive: true, force: true });
    // New example projects are added, existing ones are left alone.
    if (await exists(path.join(src, 'projects'))) await cp(path.join(src, 'projects'), path.join(root, 'projects'), { recursive: true, force: false, errorOnExist: false });
    if (oldPkg !== await readFile(path.join(root, 'package.json'), 'utf8')) {
      log('[update] Dependencies changed, running npm install...');
      spawnSync('npm', ['install', '--omit=dev'], { cwd: root, stdio: 'inherit', shell: true });
    }
    await refreshSkills().catch(e => log(`[update] Skill refresh skipped: ${e.message}`));
    log(`[update] Updated to ${remote}.`);
    return true;
  } catch (e) { log(`[update] Update failed (${e.message}); continuing with ${local}.`); return false; }
  finally { await rm(work, { recursive: true, force: true }).catch(() => {}); }
}

// npm run update: install the newer version without the page prompt.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await applyUpdate();
