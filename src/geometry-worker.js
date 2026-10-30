// CPU half of the hybrid preview: QEM simplification, topology audits and quality analysis run here, in parallel worker
// threads, so the page's main thread only feeds the GPU and stays smooth.
import { simplifyGeometry, cullSmallParts, packGeometry, unpackGeometry, transferables } from './lod.js';
import { auditGeometry } from './topology.js';
import { analyzeGeometryQuality, skinFromData } from './topology-quality.js';

const ops = {
  simplify(g, options) {
    const r = simplifyGeometry(g, options);
    if (!r || r.skipped) return [r ?? null];
    // Far-LOD detail culling happens here too, so the reduced geometry and its audit arrive final.
    const culledTriangles = options.cullDetails ? cullSmallParts(r.geometry, r.trianglesAfter - Math.floor(r.trianglesBefore * options.ratio)) : 0;
    const { geometry: out, ...stats } = r, packed = packGeometry(out);
    return [{ ...stats, culledTriangles, geometry: packed, audit: auditGeometry(out) }, transferables(packed)];
  },
  audit: g => [auditGeometry(g)],
  quality(g, options) { const r = analyzeGeometryQuality(g, { skin: skinFromData(g, options.skin) }); if (r) delete r.diagonals; return [r]; },
};
self.onmessage = ({ data: { id, op, geometry, options } }) => {
  try {
    if (!ops[op]) throw new Error(`Unknown op ${op}`);
    const [result, transfer = []] = ops[op](unpackGeometry(geometry), options ?? {});
    self.postMessage({ id, result }, transfer);
  } catch (e) { self.postMessage({ id, error: e.message }); }
};
self.postMessage({ ready: true });
