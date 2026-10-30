import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

/** Position welding is for analysis only. UV/normal splits are NOT open boundaries. */
export function auditGeometry(geometry,{edges=false}={}) {
  const p=geometry.attributes.position;
  if(!p||p.itemSize!==3)throw new Error('Triangle geometry requires vec3 positions');
  geometry.computeBoundingBox();const diagonal=geometry.boundingBox.getSize(new THREE.Vector3()).length(),epsilon=Math.max(diagonal*1e-7,1e-9);
  const positions=[],ids=new Uint32Array(p.count),buckets=new Map();
  for(let i=0;i<p.count;i++){
    const xyz=[p.getX(i),p.getY(i),p.getZ(i)],key=xyz.map(v=>Math.round(v/epsilon)).join(',');
    if(!buckets.has(key)){buckets.set(key,positions.length);positions.push(xyz);}
    ids[i]=buckets.get(key);
  }
  const index=geometry.index, count=index?.count??p.count,edgeMap=new Map(),faces=new Set(),used=new Set(),adj=new Map();
  let degenerate=0,duplicate=0,skinny=0,minQuality=1;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
  for(let t=0;t+2<count;t+=3){
    const raw=[0,1,2].map(j=>index?index.getX(t+j):t+j),v=raw.map(i=>ids[i]);
    a.fromBufferAttribute(p,raw[0]);b.fromBufferAttribute(p,raw[1]);c.fromBufferAttribute(p,raw[2]);
    const area2=ab.subVectors(b,a).cross(ac.subVectors(c,a)).length();
    if(new Set(v).size<3||area2<epsilon*epsilon){degenerate++;continue;}
    const q=2*Math.sqrt(3)*area2/(a.distanceToSquared(b)+b.distanceToSquared(c)+c.distanceToSquared(a));minQuality=Math.min(minQuality,q);if(q<0.08)skinny++;
    const face=[...v].sort((a,b)=>a-b).join(',');if(faces.has(face))duplicate++;faces.add(face);
    for(let j=0;j<3;j++){
      const u=v[j],w=v[(j+1)%3],key=u<w?`${u},${w}`:`${w},${u}`;
      const edge=edgeMap.get(key)||{count:0,direction:0,raw:[raw[j],raw[(j+1)%3]],ids:[u,w]};edge.count++;edge.direction+=u<w?1:-1;edgeMap.set(key,edge);
      used.add(u);used.add(w);if(!adj.has(u))adj.set(u,new Set());if(!adj.has(w))adj.set(w,new Set());adj.get(u).add(w);adj.get(w).add(u);
    }
  }
  const boundary=[],nonManifold=[],winding=[];
  for(const e of edgeMap.values()){if(e.count===1)boundary.push(e.raw);if(e.count>2)nonManifold.push(e.raw);if(e.count===2&&Math.abs(e.direction)===2)winding.push(e.raw);}
  const seen=new Set();let components=0;for(const v of used)if(!seen.has(v)){components++;const queue=[v];seen.add(v);while(queue.length){for(const n of adj.get(queue.pop())||[])if(!seen.has(n)){seen.add(n);queue.push(n);}}}
  const valences=[...adj.values()].map(v=>v.size),hints=[];
  if(nonManifold.length)hints.push('Non-manifold edges: revise overlapping faces, intersections or duplicated shells before reduction.');
  if(boundary.length)hints.push('Open boundaries detected: intentional sheets are valid; close holes if the asset must be a solid.');
  if(winding.length)hints.push('Inconsistent edge winding: repair face orientation in the recipe.');
  if(degenerate)hints.push('Zero-area faces: safe cleanup can remove them without changing the silhouette.');
  if(duplicate)hints.push('Duplicate/coincident faces: inspect overlapping shells; removal may change intended double surfaces.');
  if(skinny)hints.push('Thin triangles: prefer regular ring/quad spacing and redistribute samples near curvature.');
  if(!hints.length)hints.push('Closed edge-manifold triangle surface; inspect deformation and intersections separately.');
  const result={triangles:Math.floor(count/3),gpuVertices:p.count,positionVertices:used.size,edges:edgeMap.size,boundaryEdges:boundary.length,nonManifoldEdges:nonManifold.length,windingEdges:winding.length,degenerateTriangles:degenerate,duplicateTriangles:duplicate,skinnyTriangles:skinny,components,minQuality:+minQuality.toFixed(4),averageValence:valences.length?+(valences.reduce((a,b)=>a+b,0)/valences.length).toFixed(2):0,sourceQuads:geometry.userData?.sourceQuads??null,hints};
  if(edges)result.diagnostics={boundary,nonManifold,winding};return result;
}
// Audits are cached per geometry and invalidated when the position/index attribute or its version changes.
// Worker results prime the cache (primeAudit), so the main thread never repeats that work.
const auditCache=new WeakMap();
const auditKey=g=>[g.attributes.position,g.attributes.position?.version,g.index,g.index?.version];
export function cachedAudit(g){const hit=auditCache.get(g),key=auditKey(g);if(hit&&hit.key.every((v,i)=>v===key[i]))return hit.audit;const audit=auditGeometry(g);auditCache.set(g,{key,audit});return audit;}
export function primeAudit(g,audit){auditCache.set(g,{key:auditKey(g),audit});}
export function hasAudit(g){const hit=auditCache.get(g),key=auditKey(g);return !!hit&&hit.key.every((v,i)=>v===key[i]);}
export function auditTopology(root) {
  const meshes=[];root.traverse(o=>{if(o.isMesh)meshes.push({name:o.name,skinned:!!o.isSkinnedMesh,...cachedAudit(o.geometry)});});
  const total={meshes:meshes.length,triangles:0,gpuVertices:0,positionVertices:0,boundaryEdges:0,nonManifoldEdges:0,windingEdges:0,degenerateTriangles:0,duplicateTriangles:0,skinnyTriangles:0,components:0,sourceQuads:0};
  for(const m of meshes)for(const key of Object.keys(total))if(key!=='meshes')total[key]+=m[key]||0;
  const recommendations=[...new Set(meshes.flatMap(m=>m.hints).filter(h=>!h.startsWith('Closed')))];
  return {total,meshes,recommendations,scope:'Per-mesh edge connectivity after position welding; not a self-intersection or vertex-manifold certificate.'};
}

// Exact full-attribute welding: never merge vertices across UV, normal, color or weight seams.
export function weldExact(g) {
  const attrs=Object.entries(g.attributes),map=new Map(),representatives=[],remap=new Uint32Array(g.attributes.position.count);
  if(attrs.some(([,a])=>a.isInterleavedBufferAttribute))return null;
  for(let i=0;i<remap.length;i++){
    const key=attrs.map(([name,a])=>name+':'+Array.from(a.array.subarray(i*a.itemSize,(i+1)*a.itemSize)).join(',')).join('|');
    if(!map.has(key)){map.set(key,representatives.length);representatives.push(i);}remap[i]=map.get(key);
  }
  const out=g.clone();
  for(const [name,a] of attrs){const data=new a.array.constructor(representatives.length*a.itemSize);representatives.forEach((old,i)=>data.set(a.array.subarray(old*a.itemSize,(old+1)*a.itemSize),i*a.itemSize));out.setAttribute(name,new THREE.BufferAttribute(data,a.itemSize,a.normalized));}
  const source=g.index?.array??Array.from({length:remap.length},(_,i)=>i);out.setIndex(Array.from(source,i=>remap[i]));return out;
}
function compact(g) {
  const used=[...new Set(g.index.array)],map=new Map(used.map((v,i)=>[v,i]));
  for(const [name,a]of Object.entries(g.attributes)){const data=new a.array.constructor(used.length*a.itemSize);used.forEach((old,i)=>data.set(a.array.subarray(old*a.itemSize,(old+1)*a.itemSize),i*a.itemSize));g.setAttribute(name,new THREE.BufferAttribute(data,a.itemSize,a.normalized));}
  g.setIndex(Array.from(g.index.array,i=>map.get(i)));return g;
}
export async function optimizeTopology(root,{ratio=1,error=0.005,keepUndo=false}={}) {
  if(!Number.isFinite(ratio)||ratio<0.1||ratio>1||!Number.isFinite(error)||error<0||error>0.1)throw new Error('Expected ratio 0.1–1, relative error 0–0.1');
  if(ratio<1)await MeshoptSimplifier.ready;
  const changes=[],before=auditTopology(root),staged=[];
  try {
    root.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const source=mesh.geometry;
      if(Object.keys(source.morphAttributes).length||source.drawRange.start!==0||Number.isFinite(source.drawRange.count)){changes.push({name:mesh.name,skipped:'Morph targets / custom draw ranges require an author-specific optimizer'});return;}
      let g=weldExact(source);if(!g){changes.push({name:mesh.name,skipped:'Interleaved attributes'});return;}
      staged.push({mesh,old:source,g});
      const p=g.attributes.position,groups=Array.isArray(mesh.material)&&g.groups.length?g.groups:[{start:0,count:g.index.count,materialIndex:0}],indices=[],newGroups=[];let maxError=0;
      const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
      g.computeBoundingBox();const eps=Math.max(g.boundingBox.getSize(new THREE.Vector3()).length()*1e-7,1e-9);
      const positionKeys=Array.from({length:p.count},(_,i)=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v/eps)).join(','));
      const validTriangle=tri=>{
        if(new Set(tri.map(i=>positionKeys[i])).size<3)return false;
        a.fromBufferAttribute(p,tri[0]);b.fromBufferAttribute(p,tri[1]);c.fromBufferAttribute(p,tri[2]);
        return b.sub(a).cross(c.sub(a)).length()>eps*eps;
      };
      for(const group of groups){
        const clean=[];
        for(let i=group.start;i<Math.min(group.start+group.count,g.index.count);i+=3){const tri=[g.index.getX(i),g.index.getX(i+1),g.index.getX(i+2)];if(validTriangle(tri))clean.push(...tri);}
        let reduced=Uint32Array.from(clean);
        // Protect weighted and morph deformation. Rigid bone-parented parts are safe to simplify.
        if(ratio<1&&!mesh.isSkinnedMesh&&clean.length>=24){
          const selected=['normal','uv','color'].map(n=>g.attributes[n]).filter(Boolean),stride=selected.reduce((s,a)=>s+a.itemSize,0);
          const attributes=new Float32Array(p.count*stride),weights=selected.flatMap(a=>Array(a.itemSize).fill(a===g.attributes.uv?1:0.5));
          for(let i=0;i<p.count;i++){let offset=0;for(const attr of selected)for(let j=0;j<attr.itemSize;j++)attributes[i*stride+offset++]=attr.array[i*attr.itemSize+j];}
          const [out,e]=stride?MeshoptSimplifier.simplifyWithAttributes(reduced,Float32Array.from(p.array),3,attributes,stride,weights,null,Math.max(3,Math.floor(clean.length/3*ratio)*3),error,['LockBorder','Regularize']):MeshoptSimplifier.simplify(reduced,Float32Array.from(p.array),3,Math.max(3,Math.floor(clean.length/3*ratio)*3),error,['LockBorder','Regularize']);
          reduced=out;maxError=Math.max(maxError,e);
        }
        const final=[];for(let i=0;i<reduced.length;i+=3){const tri=[reduced[i],reduced[i+1],reduced[i+2]];if(validTriangle(tri))final.push(...tri);}
        newGroups.push({start:indices.length,count:final.length,materialIndex:group.materialIndex});for(const i of final)indices.push(i);
      }
      g.setIndex(indices);g.clearGroups();for(const x of newGroups)g.addGroup(x.start,x.count,x.materialIndex);
      compact(g);g.computeBoundingBox();g.computeBoundingSphere();
      if(g.index.count!== (source.index?.count??source.attributes.position.count))delete g.userData.sourceQuads;
      changes.push({name:mesh.name,verticesBefore:source.attributes.position.count,verticesAfter:g.attributes.position.count,trianglesBefore:(source.index?.count??source.attributes.position.count)/3,trianglesAfter:g.index.count/3,relativeError:maxError,protectedSkin:!!mesh.isSkinnedMesh});
    });
    for(const s of staged)s.mesh.geometry=s.g;
    const result={before:before.total,after:auditTopology(root).total,changes};
    let active=true;
    Object.defineProperties(result,{
      undo:{value:()=>{if(!active)return;for(const s of staged){s.mesh.geometry=s.old;s.g.dispose();}active=false;}},
      commit:{value:()=>{if(!active)return;new Set(staged.map(s=>s.old)).forEach(g=>g.dispose());active=false;}}
    });
    if(!keepUndo)result.commit();return result;
  }catch(e){staged.forEach(s=>{if(s.mesh.geometry===s.g)s.mesh.geometry=s.old;s.g.dispose();});throw e;}
}

/** Regular parametric quad flow. Triangulates once for WebGL while retaining source-quad metadata. */
export function quadSurface(fn,{uSegments=24,vSegments=32}={}) {
  if(!Number.isInteger(uSegments)||!Number.isInteger(vSegments)||uSegments<1||vSegments<1||uSegments*vSegments>250000)throw new Error('Invalid surface resolution');
  const positions=[],uvs=[],indices=[];
  for(let v=0;v<=vSegments;v++)for(let u=0;u<=uSegments;u++){
    const p=fn(u/uSegments,v/vSegments);if(!p||p.length!==3||!p.every(Number.isFinite))throw new Error('Surface callback must return finite [x,y,z]');positions.push(...p);uvs.push(u/uSegments,v/vSegments);
  }
  const row=uSegments+1;
  for(let v=0;v<vSegments;v++)for(let u=0;u<uSegments;u++){const a=v*row+u,b=a+1,c=a+row,d=c+1;indices.push(a,b,d,a,d,c);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();g.userData={sourceQuads:uSegments*vSegments,flow:'regular UV quad grid',uSegments,vSegments};return g;
}

export function createTopologyOverlay(root) {
  const group=new THREE.Group(),items=[];
  root.traverse(mesh=>{if(!mesh.isMesh)return;const report=auditGeometry(mesh.geometry,{edges:true});for(const [key,color] of [['boundary','#ffbd58'],['nonManifold','#ff577e'],['winding','#ad8cff']]){
    const edges=report.diagnostics[key];if(!edges.length)continue;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(edges.length*6),3));
    const lines=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color,depthTest:false,transparent:true,opacity:0.95}));lines.renderOrder=10;group.add(lines);items.push({mesh,edges,geometry,source:mesh.geometry});
  }});
  const p=new THREE.Vector3();
  group.userData.update=()=>{root.updateMatrixWorld(true);for(const {mesh,edges,geometry,source}of items){if(mesh.geometry!==source)continue;mesh.skeleton?.update();const attr=geometry.attributes.position;edges.forEach((e,i)=>e.forEach((v,j)=>{mesh.getVertexPosition(v,p).applyMatrix4(mesh.matrixWorld);attr.setXYZ(i*2+j,p.x,p.y,p.z);}));attr.needsUpdate=true;}};
  group.userData.dispose=()=>group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});group.userData.update();return group;
}
