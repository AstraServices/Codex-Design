// Path tracer worker: builds the BVH once per job, then renders the row bands it is given.
import { buildScene, traceRows } from './pathtrace-core.js';
let scene = null, job = null;
self.onmessage = ({ data }) => {
  try {
    if (data.scene) { scene = buildScene(data.scene); job = data.job; self.postMessage({ ready: true }); return; }
    const { y0, y1 } = data, r = traceRows(scene, job.cam, job.W, job.H, y0, y1, job.opts);
    self.postMessage({ y0, y1, out: r.out, aux: r.aux }, [r.out.buffer, r.aux.buffer]);
  } catch (e) { self.postMessage({ error: e.message }); }
};
