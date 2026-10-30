// Starts the local workshop if needed and opens the preview: npm run preview -- <slug> [--no-open]
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2), noOpen = args.includes('--no-open'), id = args.find(a => !a.startsWith('--'));
if (id && !/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('Usage: npm run preview -- <project-slug> [--no-open]');
if (id) await access(new URL(`../projects/${id}.json`, import.meta.url)).catch(() => { throw new Error(`Project not found: projects/${id}.json`); });
const base = process.env.CODEX_DESIGN_URL || 'http://127.0.0.1:4173', url = base + (id ? `/?project=${id}` : '/');
const healthy = async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } };
let started = false;
if (!(await healthy())) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], { cwd: fileURLToPath(new URL('..', import.meta.url)), detached: true, stdio: 'ignore', windowsHide: true });
  child.unref(); started = true;
  for (let i = 0; i < 50 && !(await healthy()); i++) await new Promise(r => setTimeout(r, 200));
  if (!(await healthy())) throw new Error('Workshop did not start on ' + base);
}
if (!noOpen) {
  const [cmd, cmdArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
console.log(JSON.stringify({ url, serverStarted: started, opened: !noOpen }));
