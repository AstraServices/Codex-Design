import { readFile } from 'node:fs/promises';
import { createKit,inspectAsset,disposeAsset } from '../src/kit.js';
import { auditTopology } from '../src/topology.js';
import { analyzeQuality } from '../src/topology-quality.js';
const id=process.argv[2]||'courier';
if(!/^[a-z][a-z0-9-]{0,63}$/.test(id))throw new Error('Invalid project id');
const meta=JSON.parse(await readFile(new URL(`../projects/${id}.json`,import.meta.url),'utf8'));
const k=createKit(meta.parameters);
await (await import(new URL(`../projects/${meta.module}`,import.meta.url))).build(k);
let topology;
if(process.argv.includes('--topology')){
  const report=auditTopology(k.root);
  topology=process.argv.includes('--details')?report:{total:report.total,recommendations:report.recommendations,issues:report.meshes.filter(m=>m.nonManifoldEdges||m.windingEdges||m.degenerateTriangles||m.duplicateTriangles).map(({name,boundaryEdges,nonManifoldEdges,windingEdges,degenerateTriangles,duplicateTriangles,skinnyTriangles})=>({name,boundaryEdges,nonManifoldEdges,windingEdges,degenerateTriangles,duplicateTriangles,skinnyTriangles}))};
}
let quality;
if(process.argv.includes('--quality')){const q=analyzeQuality(k.root);quality=process.argv.includes('--details')?q:{score:q.score,grade:q.grade,criteria:q.criteria,totals:q.totals,joints:q.joints.filter(j=>!j.ok),tips:q.tips.slice(0,6)};}
console.log(JSON.stringify({id,...inspectAsset(k.root,k.clips),...(topology?{topology}:{}),...(quality?{quality}:{})},null,2));disposeAsset(k.root);
