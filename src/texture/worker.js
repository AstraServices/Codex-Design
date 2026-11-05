// Texture Studio worker: evaluates graphs off the main thread (CPU path). GLSL nodes run on the page (GPU).
import { evaluate, validatePBR, seamScore } from './graph.js';
const graphs = new Map();
self.onmessage = async ({ data }) => {
  const { id, graph, size, seed, meshMasks, subgraphs = {}, capture } = data;
  try {
    for (const [k, v] of Object.entries(subgraphs)) graphs.set(k, v);
    const masks = meshMasks ?? {};
    const r = await evaluate(graph, { size, seed, loadGraph: async name => { const g = graphs.get(name); if (!g) throw new Error(`Subgraph ${name} not loaded`); return g; },
      mesh: (kind, S) => masks[kind] && masks[kind].size === S ? { c: masks[kind].c ?? 1, d: masks[kind].d } : null, onProgress: p => self.postMessage({ id, progress: p }), capture });
    if (capture) { const nodes = Object.fromEntries(Object.entries(r.nodes).filter(([, b]) => b?.d)); self.postMessage({ id, result: { nodes, size } }); return; }
    const issues = validatePBR(r.maps, size), seams = Object.fromEntries(['baseColor', 'height', 'roughness'].filter(k => r.maps[k]).map(k => [k, +seamScore(r.maps[k], size).score.toFixed(3)]));
    const transfer = Object.values(r.maps).map(b => b.d.buffer);
    self.postMessage({ id, result: { maps: r.maps, size, ms: r.ms, derived: r.derived, issues, seams } }, transfer);
  } catch (e) { self.postMessage({ id, error: e.message }); }
};
