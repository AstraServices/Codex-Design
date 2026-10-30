import { packGeometry, unpackGeometry, transferables, simplifyGeometry } from './lod.js';
import { cachedAudit, primeAudit, hasAudit } from './topology.js';
import { analyzeGeometryQuality, skinFromData } from './topology-quality.js';

/** Module-worker pool (one per spare CPU core, max 6) for geometry work. Morph meshes and failed workers fall back to
 *  the main thread, so results are always identical to the synchronous path. */
export function createGeometryPool({ size = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)) } = {}) {
  const workers = [], queue = [], pending = new Map(); let next = 0;
  const live = () => workers.filter(w => !w.dead);
  const pump = () => { for (const w of live()) if (w.ready && !w.busy && queue.length) { const job = queue.shift(); w.busy = job.id; w.worker.postMessage(job.msg, job.transfer); } };
  const drain = () => { if (!live().length) while (queue.length) pending.get(queue.shift().id)?.fallback(); };
  for (let i = 0; i < size; i++) {
    let w;
    try { w = { worker: new Worker(new URL('./geometry-worker.js', import.meta.url), { type: 'module' }), busy: 0, ready: false, dead: false }; } catch { break; }
    w.worker.onmessage = ({ data }) => {
      if (data.ready) { w.ready = true; return pump(); }
      const job = pending.get(data.id); pending.delete(data.id); w.busy = 0;
      if (data.error) job?.reject(new Error(data.error)); else job?.resolve(data.result);
      pump();
    };
    w.worker.onerror = e => { e.preventDefault?.(); w.dead = true; const job = pending.get(w.busy); w.busy = 0; job?.fallback(); drain(); pump(); };
    workers.push(w);
  }
  /** Runs op on a worker; `local()` computes the same result on the main thread when no worker is available. */
  function run(op, geometry, options, local, wrap = r => r) {
    if (!live().length || Object.keys(geometry.morphAttributes).length) return Promise.resolve().then(local);
    const packed = packGeometry(geometry), id = ++next;
    return new Promise((resolve, reject) => {
      const fallback = () => { pending.delete(id); try { resolve(local()); } catch (e) { reject(e); } };
      pending.set(id, { resolve: r => { try { resolve(wrap(r)); } catch (e) { reject(e); } }, reject, fallback });
      queue.push({ id, msg: { id, op, geometry: packed, options }, transfer: transferables(packed) }); pump();
    });
  }
  return {
    get size() { return live().length; },
    get threads() { return live().filter(w => w.ready).length; },
    /** Async simplifyGeometry with the same result shape; the reduced geometry arrives with its audit already cached. */
    simplify: (geometry, options) => run('simplify', geometry, options, () => simplifyGeometry(geometry, options), r => {
      if (!r || r.skipped) return r;
      const { audit, ...rest } = r, g = unpackGeometry(r.geometry); primeAudit(g, audit); return { ...rest, geometry: g };
    }),
    /** Audits every mesh under root in parallel and fills the audit cache (auditTopology is then instant). */
    async auditAll(root) {
      const list = []; root.traverse(o => { if (o.isMesh && !hasAudit(o.geometry)) list.push(o.geometry); });
      await Promise.all(list.map(g => run('audit', g, {}, () => cachedAudit(g), a => { primeAudit(g, a); return a; })));
    },
    quality: (geometry, skin) => run('quality', geometry, { skin }, () => { const r = analyzeGeometryQuality(geometry, { skin: skinFromData(geometry, skin) }); if (r) delete r.diagonals; return r; }),
    dispose() { workers.forEach(w => w.worker.terminate()); },
  };
}
let shared;
/** One pool per page. */
export const geometryPool = () => (shared ??= createGeometryPool());
