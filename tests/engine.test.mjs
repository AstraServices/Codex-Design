import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createKit,inspectAsset,THREE } from '../src/kit.js';
import { bakePose,encodeAsset } from '../src/exporters.js';
import { unzipSync,strFromU8 } from 'fflate';
import { auditGeometry,auditTopology,optimizeTopology,quadSurface } from '../src/topology.js';
async function build(id){const meta=JSON.parse(await readFile(new URL(`../projects/${id}.json`,import.meta.url)));const k=createKit(meta.parameters);await(await import(`../projects/${meta.module}`)).build(k);return k;}
for(const id of ['courier','kelp','vessel'])test(`${id}: valid geometry and bound animation tracks`,async()=>{
  const k=await build(id),s=inspectAsset(k.root,k.clips);assert.equal(s.warnings.length,0);assert.ok(s.triangles>100);assert.ok(k.clips.length);
  const mixer=new THREE.AnimationMixer(k.root);for(const c of k.clips){assert.ok(c.validate());mixer.stopAllAction();mixer.clipAction(c).play();mixer.setTime(c.duration/2);k.root.updateMatrixWorld(true);k.root.traverse(o=>assert.ok(o.matrixWorld.elements.every(Number.isFinite)));}
});
test('weighted vertices really deform and static exports bake the current pose',async()=>{
  const k=await build('kelp'),mesh=k.root.getObjectByName('SoftBody'),v0=new THREE.Vector3(),v1=new THREE.Vector3();
  const p=mesh.geometry.attributes.position;let tip=0;for(let i=1;i<p.count;i++)if(p.getY(i)>p.getY(tip))tip=i;
  mesh.getVertexPosition(tip,v0);const mixer=new THREE.AnimationMixer(k.root);mixer.clipAction(k.clips[1]).play();mixer.setTime(2);k.root.updateMatrixWorld(true);mesh.skeleton.update();mesh.getVertexPosition(tip,v1);
  assert.ok(v0.distanceTo(v1)>0.2);
  const baked=bakePose(k.root);const out=baked.getObjectByName('SoftBody');const b=new THREE.Vector3().fromBufferAttribute(out.geometry.attributes.position,tip);v1.applyMatrix4(mesh.matrixWorld);assert.ok(v1.distanceTo(b)<1e-5);assert.ok(!out.isSkinnedMesh);
  const exported=await encodeAsset(k.root,k.clips,'obj');const files=unzipSync(exported.data);assert.match(strFromU8(files['model.obj']),/mtllib materials.mtl/);assert.match(strFromU8(files['materials.mtl']),/newmtl/);
});
test('skin weights are normalized and indices point to existing bones',async()=>{
  for(const id of ['courier','kelp']){const k=await build(id);k.root.traverse(o=>{if(!o.isSkinnedMesh)return;const w=o.geometry.attributes.skinWeight,indices=o.geometry.attributes.skinIndex;for(let i=0;i<w.count;i++){assert.ok(Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1)<1e-5);for(let j=0;j<4;j++)assert.ok(indices.array[i*4+j]<o.skeleton.bones.length);}});}
});
test('CSG removes material at the handle opening',async()=>{
  const k=await build('vessel');assert.equal(k.root.getObjectByName('RawHandle'),undefined);const handle=k.root.getObjectByName('Handle');assert.ok(handle.geometry.attributes.position.count>100);
  k.root.updateMatrixWorld(true);const ray=new THREE.Raycaster(new THREE.Vector3(0,2.29,2),new THREE.Vector3(0,0,-1));assert.equal(ray.intersectObject(handle).length,0);
});
test('topology analysis distinguishes seams, open edges, non-manifold and degenerates',()=>{
  const sphere=auditGeometry(new THREE.SphereGeometry(1,16,12));assert.equal(sphere.boundaryEdges,0);assert.equal(sphere.nonManifoldEdges,0);
  const plane=auditGeometry(new THREE.PlaneGeometry());assert.equal(plane.boundaryEdges,4);assert.equal(plane.components,1);
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0,0,-1,0,0,0,1],3));geo.setIndex([0,1,2,1,0,3,0,1,4,0,0,1]);
  const report=auditGeometry(geo);assert.equal(report.nonManifoldEdges,1);assert.equal(report.degenerateTriangles,1);
});
test('optimization reduces static triangles within error constraints and can undo',async()=>{
  const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.SphereGeometry(1,48,32),new THREE.MeshStandardMaterial());root.add(mesh);const original=mesh.geometry;
  const result=await optimizeTopology(root,{ratio:0.5,error:0.02,keepUndo:true});assert.ok(result.after.triangles<result.before.triangles*0.8);assert.ok(result.after.gpuVertices<result.before.gpuVertices);assert.equal(auditGeometry(mesh.geometry).nonManifoldEdges,0);
  result.undo();assert.equal(mesh.geometry,original);
});
test('optimization keeps weighted deformation and material groups intact',async()=>{
  const k=await build('kelp'),mesh=k.root.getObjectByName('SoftBody'),original=mesh.geometry.clone(),before=mesh.geometry.index.count;
  const result=await optimizeTopology(k.root,{ratio:0.3});assert.equal(mesh.geometry.index.count,before);assert.ok(result.changes.find(c=>c.name==='SoftBody').protectedSkin);
  const p=mesh.geometry.attributes.position,w=mesh.geometry.attributes.skinWeight;for(let i=0;i<w.count;i++)assert.ok(Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1)<1e-5);
  const mixer=new THREE.AnimationMixer(k.root);mixer.clipAction(k.clips[1]).play();mixer.setTime(2);k.root.updateMatrixWorld(true);mesh.skeleton.update();let max=0;for(let i=0;i<p.count;i++){const posed=mesh.getVertexPosition(i,new THREE.Vector3());max=Math.max(max,posed.distanceTo(new THREE.Vector3().fromBufferAttribute(p,i)));}assert.ok(max>0.5);
  const v=await build('vessel');await optimizeTopology(v.root,{ratio:0.6});v.root.traverse(o=>{if(!o.isMesh)return;const materialCount=Array.isArray(o.material)?o.material.length:1;for(const g of o.geometry.groups){assert.ok(g.materialIndex<materialCount);assert.ok(g.start+g.count<=o.geometry.index.count);}});
});
test('quad flow creates a regular, inspectable surface and cleanup removes zero-area faces',async()=>{
  const g=quadSurface((u,v)=>[u,v,Math.sin(u*3)*0.1],{uSegments:8,vSegments:10}),r=auditGeometry(g);assert.equal(r.sourceQuads,80);assert.equal(r.triangles,160);assert.equal(r.degenerateTriangles,0);
  const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshStandardMaterial());root.add(mesh);const indices=Array.from(mesh.geometry.index.array);mesh.geometry.setIndex([...indices,0,0,1]);const optimized=await optimizeTopology(root);assert.equal(optimized.before.degenerateTriangles,1);assert.equal(optimized.after.degenerateTriangles,0);assert.equal(optimized.after.triangles,2);
});
test('robot cleanup resolves reported degenerates and retains its rig',async()=>{
  const k=await build('courier'),report=await optimizeTopology(k.root,{ratio:0.6});assert.equal(report.after.degenerateTriangles,0);assert.equal(report.after.nonManifoldEdges,0);assert.equal(inspectAsset(k.root,k.clips).bones,13);
});
