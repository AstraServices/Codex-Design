import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createKit, THREE } from '../src/kit.js';
import { simplifyGeometry, optimizeLOD, estimateNormalCrease, cullSmallParts } from '../src/lod.js';
import { analyzeGeometryQuality, analyzeQuality, fixGeometry } from '../src/topology-quality.js';
import { auditGeometry, quadSurface } from '../src/topology.js';

async function build(id){const meta=JSON.parse(await readFile(new URL(`../projects/${id}.json`,import.meta.url)));const k=createKit(meta.parameters);await(await import(`../projects/${meta.module}`)).build(k);return k;}
// One-sided Hausdorff-style check: every original vertex lies close to the reduced surface.
function deviation(original,reduced){
  const mesh=new THREE.Mesh(reduced),p=original.attributes.position,v=new THREE.Vector3(),tri=new THREE.Triangle(),q=new THREE.Vector3(),idx=reduced.index.array,rp=reduced.attributes.position;let worst=0;
  for(let i=0;i<p.count;i+=7){v.fromBufferAttribute(p,i);let best=Infinity;for(let f=0;f<idx.length;f+=3){tri.set(new THREE.Vector3().fromBufferAttribute(rp,idx[f]),new THREE.Vector3().fromBufferAttribute(rp,idx[f+1]),new THREE.Vector3().fromBufferAttribute(rp,idx[f+2]));tri.closestPointToPoint(v,q);best=Math.min(best,q.distanceTo(v));}worst=Math.max(worst,best);}
  mesh.geometry=null;return worst;
}

test('QEM keeps the silhouette: sphere at −70% stays within the error budget and closed',()=>{
  const g=new THREE.SphereGeometry(1,48,32),r=simplifyGeometry(g,{ratio:0.3,maxError:0.015});
  assert.ok(r.trianglesAfter<=r.trianglesBefore*0.32);const a=auditGeometry(r.geometry);assert.equal(a.boundaryEdges,0);assert.equal(a.nonManifoldEdges,0);
  assert.ok(deviation(g,r.geometry)<0.015*2*Math.sqrt(3)+1e-6);
});
test('flat areas collapse first and hard edges survive: subdivided box keeps 8 corners and its size',()=>{
  const g=new THREE.BoxGeometry(1,1,1,8,8,8),r=simplifyGeometry(g,{ratio:0.05,maxError:0.01});
  assert.ok(r.trianglesAfter<g.index.count/3*0.3);r.geometry.computeBoundingBox();assert.ok(r.geometry.boundingBox.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3(1,1,1))<1e-6);
  assert.ok(r.relativeError<1e-9,'planar collapses add no geometric error');
});
test('UV seams stay locked and UVs follow the surface',()=>{
  const g=new THREE.SphereGeometry(1,32,24),r=simplifyGeometry(g,{ratio:0.4,maxError:0.02}),uv=r.geometry.attributes.uv;
  for(let i=0;i<uv.count;i++){assert.ok(uv.getX(i)>=-1e-6&&uv.getX(i)<=1+1e-6);assert.ok(uv.getY(i)>=-1e-6&&uv.getY(i)<=1+1e-6);}
  assert.ok(r.lockedVertices>0);
});
test('hard-surface normals are detected and rebuilt with creases',()=>{
  const g=new THREE.BoxGeometry(1,1,1,4,4,4),c=estimateNormalCrease(g);assert.ok(c&&c.normalAngle>45);
  const r=simplifyGeometry(g,{ratio:0.2,maxError:0.01});const n=r.geometry.attributes.normal;
  for(let i=0;i<n.count;i++){const v=new THREE.Vector3(n.getX(i),n.getY(i),n.getZ(i));assert.ok(Math.max(Math.abs(v.x),Math.abs(v.y),Math.abs(v.z))>0.999,'box normals stay axis-aligned');}
});
test('skinned LOD: weights stay normalized, joints keep their loops and the mesh still bends',async()=>{
  const k=await build('kelp'),mesh=k.root.getObjectByName('SoftBody'),before=mesh.geometry.index.count/3;
  const r=optimizeLOD(k.root,{reduction:0.5,maxError:0.015});assert.ok(mesh.geometry.index.count/3<before*0.8);assert.equal(r.after.nonManifoldEdges,0);assert.equal(r.after.boundaryEdges,0);
  const w=mesh.geometry.attributes.skinWeight;for(let i=0;i<w.count;i++)assert.ok(Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1)<1e-4);
  const q=analyzeQuality(k.root);assert.ok(q.joints.length>=4);assert.ok(q.joints.every(j=>j.loops>=3),JSON.stringify(q.joints));
  const p=mesh.geometry.attributes.position;let tip=0;for(let i=1;i<p.count;i++)if(p.getY(i)>p.getY(tip))tip=i;
  const v0=mesh.getVertexPosition(tip,new THREE.Vector3()),mixer=new THREE.AnimationMixer(k.root);mixer.clipAction(k.clips[1]).play();mixer.setTime(2);k.root.updateMatrixWorld(true);mesh.skeleton.update();
  assert.ok(mesh.getVertexPosition(tip,new THREE.Vector3()).distanceTo(v0)>0.2);
});
test('error budget stops before breaking: never exceeds maxError, and undo restores',async()=>{
  const k=await build('courier'),tris=analyzeQuality(k.root).totals.triangles,r=optimizeLOD(k.root,{reduction:0.9,maxError:0.01,keepUndo:true});
  assert.ok(r.maxError<=0.0101);assert.ok(r.achieved<0.9,'stops at the budget instead of collapsing the silhouette');assert.equal(r.after.boundaryEdges,r.before.boundaryEdges);
  r.undo();assert.equal(analyzeQuality(k.root).totals.triangles,tris);
});
test('detail culling removes small detached parts first',()=>{
  const parts=[new THREE.BoxGeometry(2,2,2,4,4,4)];for(let i=0;i<20;i++){const b=new THREE.BoxGeometry(0.05,0.05,0.05);b.translate(-1+i*0.1,1.1,0);parts.push(b);}
  const g=(await_merge(parts)),before=g.index.count/3,removed=cullSmallParts(g,240);assert.equal(removed,240);g.computeBoundingBox();assert.ok(g.boundingBox.getSize(new THREE.Vector3()).y<2.01,'big body kept, tiny parts gone');assert.equal(g.index.count/3,before-removed);
});
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
function await_merge(parts){return mergeGeometries(parts.map(p=>p.toNonIndexed()).map(p=>{p.setIndex([...Array(p.attributes.position.count).keys()]);return p;}));}
test('quality analyzer: quad grid scores A, star caps count as n-gons, skinned joints are measured',async()=>{
  const grid=analyzeGeometryQuality(quadSurface((u,v)=>[u,v,0],{uSegments:10,vSegments:10}));assert.equal(grid.quadRatio,1);assert.equal(grid.ngons,0);assert.equal(grid.grade,'A');
  const disc=analyzeGeometryQuality(new THREE.CircleGeometry(1,16));assert.equal(disc.ngons,1);
  const cyl=analyzeGeometryQuality(new THREE.CylinderGeometry(1,1,2,24,4));assert.equal(cyl.ngons,2);
  const q=analyzeQuality((await build('kelp')).root);assert.equal(q.criteria.joints,1);assert.ok(q.score>=85);
});
test('smart fix flips only flat edges and keeps the surface exactly in place',()=>{
  // A flat fan with poor triangles plus a curved cap: the plane gets better, the curve stays untouched.
  const g=new THREE.PlaneGeometry(2,2,6,6);const pos=g.attributes.position;for(let i=0;i<pos.count;i++)pos.setX(i,pos.getX(i)*(1+0.3*Math.sin(i)));
  const before=analyzeGeometryQuality(g),r=fixGeometry(g),after=analyzeGeometryQuality(r.geometry);
  assert.ok(after.score>=before.score);const p=r.geometry.attributes.position;for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getZ(i))<1e-9,'stays on the plane');
  const s=new THREE.SphereGeometry(1,24,16),fs=fixGeometry(s);const sp=fs.geometry.attributes.position;for(let i=0;i<sp.count;i++)assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(sp,i).length()-1)<1e-5,'curved vertices untouched');
});
test('worker path matches the sync path: packed geometry round-trips, async LOD and quality give identical results',async()=>{
  const { optimizeLODAsync, packGeometry, unpackGeometry } = await import('../src/lod.js');
  const { analyzeQualityAsync, skinFromData } = await import('../src/topology-quality.js');
  // Simulated worker: serialize like postMessage does, run the sync code, deserialize.
  const viaClone = (g, o) => { const r = simplifyGeometry(unpackGeometry(structuredClone(packGeometry(g))), o); return Promise.resolve(r && { ...r, geometry: unpackGeometry(structuredClone(packGeometry(r.geometry))) }); };
  const a = await build('kelp'), b = await build('kelp');
  const sync = optimizeLOD(a.root, { reduction: 0.5, maxError: 0.015 }), async_ = await optimizeLODAsync(b.root, { reduction: 0.5, maxError: 0.015 }, viaClone);
  assert.equal(async_.after.triangles, sync.after.triangles); assert.equal(async_.maxError, sync.maxError);
  const q1 = analyzeQuality(a.root), q2 = await analyzeQualityAsync(b.root, (g, skin) => Promise.resolve(analyzeGeometryQuality(g, { skin: skinFromData(g, structuredClone(skin)) })));
  assert.equal(q2.score, q1.score); assert.deepEqual(q2.joints.map(j => j.loops), q1.joints.map(j => j.loops));
});
