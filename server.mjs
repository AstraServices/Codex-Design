import http from 'node:http';
import { readFile, readdir, writeFile, rename, stat, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
// Bundled ffmpeg (npm ffmpeg-static): no separate install. FFMPEG env var overrides; system ffmpeg is the last resort.
const ffmpegPath = process.env.FFMPEG || (await import('ffmpeg-static').then(m => m.default).catch(() => null)) || 'ffmpeg';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkForUpdate, applyUpdate, localVersion } from './scripts/update.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const clients = new Set();
// On start: compare version.txt with GitHub. The page shows the result and asks before installing.
let updateStatus = checkForUpdate();
const version = await localVersion();
const mime = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.glb':'model/gltf-binary', '.gltf':'model/gltf+json', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.lua':'text/plain', '.txt':'text/plain', '.csv':'text/csv' };
const slugOK = s => /^[a-z][a-z0-9-]{0,63}$/.test(s);
async function jsonBody(req, limit = 256_000) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > limit) throw new Error('Request too large'); }
  return JSON.parse(data);
}
function send(res, code, value) { res.writeHead(code, { 'Content-Type':'application/json' }); res.end(JSON.stringify(value)); }
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host;
    if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(host)) return send(res, 403, {error:'Loopback requests only'});
    if (req.headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin)) return send(res,403,{error:'Origin rejected'});
    const url = new URL(req.url, `http://${host}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
      res.write(': connected\n\n'); clients.add(res); req.on('close',()=>clients.delete(res)); return;
    }
    // GET → {local, remote, available}; POST installs it, then the server restarts with the new files.
    if (pathname === '/api/update' && req.method === 'GET') return send(res, 200, await updateStatus);
    if (pathname === '/api/update' && req.method === 'POST') {
      if (!await applyUpdate()) { updateStatus = checkForUpdate(); return send(res, 500, { error: 'Update failed; see the server console.' }); }
      send(res, 200, { ok: true, restarting: true });
      server.close(); for (const c of clients) c.end();
      spawn(process.execPath, process.argv.slice(1), { stdio: 'inherit' }).on('exit', code => process.exit(code ?? 0));
      return;
    }
    if (pathname === '/api/health') return send(res,200,{ok:true, engine:'Three.js', version, root});
    if (pathname === '/api/projects' && req.method === 'GET') {
      const names = (await readdir(path.join(root,'projects'))).filter(f=>f.endsWith('.json'));
      const projects = await Promise.all(names.map(async file=>({id:file.slice(0,-5), ...JSON.parse(await readFile(path.join(root,'projects',file),'utf8'))})));
      return send(res,200,projects);
    }
    // Workspace (hidden models in the sidebar) and shared GFX settings (watermark defaults), both used by UI and CLI.
    for (const [route, file, limit] of [['/api/workspace', 'workspace.json', 64_000], ['/api/gfx-config', 'gfx.config.json', 3_000_000]]) {
      if (pathname !== route) continue;
      const filename = path.join(root, file);
      if (req.method === 'GET') { try { return send(res, 200, JSON.parse(await readFile(filename, 'utf8'))); } catch { return send(res, 200, {}); } }
      if (req.method === 'PUT') {
        const body = await jsonBody(req, limit);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'JSON object required' });
        if (file === 'workspace.json' && (!Array.isArray(body.hidden) || !body.hidden.every(slugOK))) return send(res, 400, { error: 'hidden must be a list of project ids' });
        await writeFile(filename + '.tmp', JSON.stringify(body, null, 2) + '\n'); await rename(filename + '.tmp', filename); return send(res, 200, body);
      }
    }
    // Animated GFX: POST /api/video → {id}; PUT /api/video/<id>/frame/<n> (JPEG/PNG bytes); POST /api/video/<id>/encode
    // {format:'mp4'|'gif', fps, name, width} → ffmpeg writes exports/<name>.<ext>. Frames live in work/video/<id>/.
    if (pathname === '/api/video' && req.method === 'POST') { const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7); await mkdir(path.join(root, 'work', 'video', id), { recursive: true }); return send(res, 200, { id }); }
    const vm = pathname.match(/^\/api\/video\/([a-z0-9]+)\/(frame\/(\d{1,5})|encode)$/);
    if (vm) {
      const dir = path.join(root, 'work', 'video', vm[1]); await stat(dir);
      if (vm[3] !== undefined && req.method === 'PUT') {
        const chunks = []; let size = 0; for await (const c of req) { size += c.length; if (size > 12_000_000) throw new Error('Frame too large'); chunks.push(c); }
        const buf = Buffer.concat(chunks), ext = buf[0] === 0x89 ? 'png' : 'jpg';
        await writeFile(path.join(dir, `f${String(vm[3]).padStart(5, '0')}.${ext}`), buf); return send(res, 200, { ok: true });
      }
      if (vm[2] === 'encode' && req.method === 'POST') {
        const { format = 'mp4', fps = 30, name = 'gfx', width = 0, loop = 0 } = await jsonBody(req);
        if (!['mp4', 'gif'].includes(format) || !/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(name) || !(fps >= 1 && fps <= 60)) return send(res, 400, { error: 'format mp4|gif, fps 1–60, safe name required' });
        const files = (await readdir(dir)).filter(f => /^f\d{5}\.(jpg|png)$/.test(f)).sort(); if (!files.length) return send(res, 400, { error: 'No frames' });
        const ext = path.extname(files[0]), out = path.join(root, 'exports', `${name}.${format}`), input = path.join(dir, `f%05d${ext}`);
        const scale = width ? `scale=${Number(width)}:-2:flags=lanczos,` : '';
        const args = format === 'mp4'
          ? ['-y', '-framerate', String(fps), '-i', input, '-vf', `${scale}format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-movflags', '+faststart', out]
          : ['-y', '-framerate', String(fps), '-i', input, '-vf', `${scale}split[a][b];[a]palettegen=stats_mode=diff:max_colors=256[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, '-loop', String(loop), out];
        const code = await new Promise(resolve => { const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; p.stderr.on('data', d => { err = (err + d).slice(-2000); }); p.on('error', () => resolve({ code: -1, err: 'ffmpeg not found (run npm install, or set FFMPEG)' })); p.on('close', c => resolve({ code: c, err })); });
        await rm(dir, { recursive: true, force: true });
        if (code.code !== 0) return send(res, 500, { error: 'ffmpeg failed: ' + code.err.split('\n').slice(-4).join(' ') });
        return send(res, 200, { file: `exports/${name}.${format}`, frames: files.length, bytes: (await stat(out)).size });
      }
    }
    // Model thumbnails for the asset library: PUT {base64} → exports/thumbs/<id>.png
    if (pathname.startsWith('/api/thumbs/') && req.method === 'PUT') {
      const id = pathname.split('/').pop(); if (!slugOK(id)) return send(res, 400, { error: 'Invalid project id' });
      const { base64 } = await jsonBody(req, 4_000_000); const png = Buffer.from(String(base64 ?? ''), 'base64');
      if (png.length < 8 || png[0] !== 137 || png[1] !== 80) return send(res, 400, { error: 'PNG required' });
      await mkdir(path.join(root, 'exports', 'thumbs'), { recursive: true }); await writeFile(path.join(root, 'exports', 'thumbs', id + '.png'), png); return send(res, 200, { ok: true });
    }
    if (pathname.startsWith('/api/projects/') && req.method === 'PUT') {
      const id = pathname.split('/').pop();
      if (!slugOK(id)) return send(res,400,{error:'Invalid project id'});
      const filename = path.join(root,'projects',id+'.json');
      const current = JSON.parse(await readFile(filename,'utf8'));
      const {parameters} = await jsonBody(req);
      if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return send(res,400,{error:'parameters must be an object'});
      for (const [key,value] of Object.entries(parameters)) {
        const spec = current.controls?.[key];
        if (!spec) return send(res,400,{error:`Unknown parameter: ${key}`});
        if (spec.type === 'color' ? !/^#[a-f\d]{6}$/i.test(value) : typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max) return send(res,400,{error:`Invalid parameter: ${key}`});
      }
      current.parameters = {...current.parameters,...parameters};
      await writeFile(filename+'.tmp',JSON.stringify(current,null,2)+'\n'); await rename(filename+'.tmp',filename);
      return send(res,200,current);
    }
    if (req.method !== 'GET') return send(res,405,{error:'Method not allowed'});
    const allowed = pathname === '/' || pathname === '/index.html' || /^\/(src|projects|node_modules|assets|exports)\//.test(pathname);
    if (!allowed || pathname.split('/').some(s=>s.startsWith('.') || s.includes('\\'))) return send(res,404,{error:'Not found'});
    const target = path.resolve(root,pathname==='/'?'index.html':'.'+pathname);
    if (!target.startsWith(root+path.sep)) return send(res,403,{error:'Path rejected'});
    if (!(await stat(target)).isFile()) return send(res,404,{error:'Not found'});
    res.writeHead(200, {'Content-Type':mime[path.extname(target)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    const body = await readFile(target);
    res.end(path.extname(target) === '.js' ? await resolveBareImports(body.toString('utf8')) : body);
  } catch(e) { send(res,e.code==='ENOENT'?404:400,{error:e.message}); }
});
// Module workers do not see the page's import map, so JS is served with bare specifiers resolved through the
// same map (index.html). The URLs are identical, so page and workers share one module instance per file.
let importMap;
async function resolveBareImports(code) {
  importMap ??= JSON.parse((await readFile(path.join(root,'index.html'),'utf8')).match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  return code.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"./][^'"]*)\2/g, (m, pre, q, spec) => {
    if (importMap[spec]) return pre + q + importMap[spec] + q;
    const prefix = Object.keys(importMap).find(k => k.endsWith('/') && spec.startsWith(k));
    return prefix ? pre + q + importMap[prefix] + spec.slice(prefix.length) + q : m;
  });
}
let timer;
for (const dir of ['projects','src']) watch(path.join(root,dir),{recursive:true},()=>{
  clearTimeout(timer); timer=setTimeout(()=>{for(const client of clients) client.write(`data: ${Date.now()}\n\n`);},180);
});
server.listen(port,'127.0.0.1',()=>console.log(`Codex Design 3D → http://127.0.0.1:${port}`));
