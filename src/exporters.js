import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { zipSync, strToU8 } from 'fflate';
import { bakeHighlightShells, highlightsToLuau, tagHighlightExtensions, rgb, lua } from './highlight.js';
import { bakeEdgeGeometry, tagEdgeExtensions, edgeLuauDefinitions } from './edges.js';
import { quadFaces } from './topology-quality.js';
import { prepareRoblox, robloxPackage, bakeRobloxUVs, sharedRobloxSkin } from './roblox-export.js';
const outlineLuau=(root,name)=>highlightsToLuau(root,name,edgeLuauDefinitions(root,name,rgb,lua));

// PBR baseColorFactor is bounded by the glTF schema. Older brightened stud
// materials multiplied linear colors above 1, producing invalid import files.
export function normalizeExportMaterials(root){
  const cache=new Map(),warnings=[];
  root.traverse(o=>{
    if(!o.isMesh)return;
    const convert=m=>{
      if(cache.has(m))return cache.get(m);
      const copy=m.clone();
      if(copy.color){const values=copy.color.toArray();if(values.some(v=>!Number.isFinite(v)))throw new Error(`${m.name||o.name}: nonfinite material color`);if(values.some(v=>v<0||v>1)){copy.color.setRGB(...values.map(v=>THREE.MathUtils.clamp(v,0,1)));warnings.push(`${m.name||o.name}: HDR base color clamped to glTF range 0–1`);}}
      cache.set(m,copy);return copy;
    };
    o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);
  });
  if(warnings.length)root.userData.codexExportWarnings=[...new Set(warnings)];
  return warnings;
}

// Bake world transforms, morphs, skinning and instances into a temporary static tree.
export function bakePose(root) {
  root.updateMatrixWorld(true);
  const baked = new THREE.Group(); baked.name='BakedPose';
  root.traverse(object=>{
    if(!object.isMesh || !object.visible) return;
    for(let parent=object.parent;parent;parent=parent.parent)if(!parent.visible)return;
    object.skeleton?.update();
    const geo=object.geometry.clone(), p=geo.attributes.position, v=new THREE.Vector3();
    for(let i=0;i<p.count;i++) { object.getVertexPosition(i,v); p.setXYZ(i,v.x,v.y,v.z); }
    geo.deleteAttribute('skinIndex');geo.deleteAttribute('skinWeight');geo.morphAttributes={};
    geo.computeVertexNormals();
    for(let i=0;i<(object.isInstancedMesh?object.count:1);i++) {
      const g=geo.clone(),matrix=object.matrixWorld.clone();
      if(object.isInstancedMesh){const instance=new THREE.Matrix4();object.getMatrixAt(i,instance);matrix.multiply(instance);}
      g.applyMatrix4(matrix);
      // Correct winding for reflected transforms.
      if(matrix.determinant()<0) {
        if(g.index){for(let j=0;j<g.index.count;j+=3){const a=g.index.getX(j);g.index.setX(j,g.index.getX(j+2));g.index.setX(j+2,a);}}
        else {for(const attr of Object.values(g.attributes)){for(let j=0;j<attr.count;j+=3){for(let d=0;d<attr.itemSize;d++){const a=attr.array[j*attr.itemSize+d];attr.array[j*attr.itemSize+d]=attr.array[(j+2)*attr.itemSize+d];attr.array[(j+2)*attr.itemSize+d]=a;}}}}
        g.computeVertexNormals();
      }
      const materials=(Array.isArray(object.material)?object.material:[object.material]).map(m=>m.clone());
      const mesh=new THREE.Mesh(g,Array.isArray(object.material)?materials:materials[0]);mesh.name=object.name+(object.isInstancedMesh?'_'+i:'');baked.add(mesh);
    }
    geo.dispose();
  });
  return baked;
}
// computeTangents leaves zero/NaN tangents where UVs are degenerate (e.g. zero UVs); glTF requires unit tangents.
function repairTangents(g){const t=g.attributes.tangent,n=g.attributes.normal,v=new THREE.Vector3(),m=new THREE.Vector3();for(let i=0;i<t.count;i++){v.set(t.getX(i),t.getY(i),t.getZ(i));const w=t.getW(i);if(Number.isFinite(v.x+v.y+v.z)&&v.lengthSq()>1e-12){v.normalize();t.setXYZW(i,v.x,v.y,v.z,w<0?-1:1);continue;}m.set(n.getX(i),n.getY(i),n.getZ(i));v.set(Math.abs(m.x)<0.9?1:0,Math.abs(m.x)<0.9?0:1,0).cross(m).normalize();t.setXYZW(i,v.x,v.y,v.z,1);}}
export async function encodeAsset(root,clips,format,options={}) {
  if(format==='roblox'){
    const source=cloneSkeleton(root),bake=options.bakeHighlights===undefined?'full':options.bakeHighlights;
    const tagged=tagHighlightExtensions(source)+tagEdgeExtensions(source);
    if(bake&&tagged){bakeHighlightShells(source,{fill:bake==='full'});bakeEdgeGeometry(source);}
    const scene=prepareRoblox(source,clips);bakeRobloxUVs(scene);normalizeExportMaterials(scene);
    return robloxPackage(scene,clips,new GLTFExporter(),options);
  }
  if(format==='lua')return {data:strToU8(outlineLuau(root,options.name||'Asset')),extension:'outline.lua',mime:'text/x-lua'};
  if(format==='glb'||format==='gltf') {
    // glTF skins ignore parent transforms. Lift cloned skinned meshes to scene roots;
    // bind matrices retain the authored bind space, while joints stay in their hierarchy.
    const canonical=options.target==='roblox';
    const scene=canonical?prepareRoblox(root,clips):new THREE.Scene(),copy=canonical?scene:cloneSkeleton(root);
    if(!canonical)scene.add(copy);scene.updateMatrixWorld(true);
    if(canonical)bakeRobloxUVs(scene);
    // Highlights travel three ways: CODEX_highlight node extension + extras (exact settings, re-importable),
    // baked unlit shells (visible in any glTF viewer/engine), and a Roblox Luau script in the scene extras.
    // bakeHighlights: 'full' (outline + fill shells, default) | 'outline' | false (metadata only).
    const bake=options.bakeHighlights===undefined||options.bakeHighlights===true?'full':options.bakeHighlights;
    // Edge outlines (CODEX_edges) always bake to real line + silhouette geometry unless settings-only export is chosen.
    const tagged=tagHighlightExtensions(copy)+tagEdgeExtensions(copy);
    if(bake&&tagged){bakeHighlightShells(copy,{fill:bake==='full'});bakeEdgeGeometry(copy);}
    if(tagged)copy.userData.codexHighlightLuau=outlineLuau(copy,options.name||'Asset');
    normalizeExportMaterials(copy);
    // Normal-mapped primitives ship MikkTSpace-style tangents instead of relying on runtime generation.
    copy.traverse(o=>{const g=o.geometry,mats=o.isMesh?(Array.isArray(o.material)?o.material:[o.material]):[];if(!mats.some(m=>m?.normalMap)||g.attributes.tangent||!g.index||!g.attributes.uv||!g.attributes.normal)return;o.geometry=g.clone();o.geometry.computeTangents();repairTangents(o.geometry);});
    const skins=[];if(!canonical)copy.traverse(o=>{if(o.isSkinnedMesh)skins.push(o);});
    for(const skin of skins){scene.attach(skin);skin.position.set(0,0,0);skin.quaternion.identity();skin.scale.set(1,1,1);skin.updateMatrix();}
    const exporter=new GLTFExporter();if(canonical)sharedRobloxSkin(exporter);
    const result=await exporter.parseAsync(scene,{binary:format==='glb',animations:clips,trs:true,onlyVisible:true,includeCustomExtensions:true});
    return {data:format==='glb'?new Uint8Array(result):strToU8(JSON.stringify(result)),extension:format,mime:format==='glb'?'model/gltf-binary':'model/gltf+json'};
  }
  if(format==='json')return {data:strToU8(JSON.stringify({...root.toJSON(),animations:clips.map(c=>THREE.AnimationClip.toJSON(c))})),extension:'three.json',mime:'application/json'};
  if(format==='obj'||format==='stl') {
    const baked=bakePose(root);
    try {
      if(format==='stl') {
        const data=new STLExporter().parse(baked,{binary:true});return {data:new Uint8Array(data.buffer,data.byteOffset,data.byteLength),extension:'stl',mime:'model/stl'};
      }
      // OBJ keeps quads: paired triangles (or a mesh's explicit quad list) are written as 4-vertex faces, the rest as
      // triangles — the modeling hand-off format. Positions, UVs and normals per vertex; one plain-color MTL per group.
      let text='mtllib materials.mtl\n',mtl='',offset=0,matIndex=0,quadCount=0,triCount=0;
      baked.children.forEach(mesh=>{
        const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material],geo=mesh.geometry.index?mesh.geometry:mesh.geometry.clone().setIndex([...Array(mesh.geometry.attributes.position.count).keys()]);
        const p=geo.attributes.position,n=geo.attributes.normal,uv=geo.attributes.uv,f=v=>+v.toFixed(6);
        text+=`o ${mesh.name||'mesh'}\n`;
        for(let i=0;i<p.count;i++)text+=`v ${f(p.getX(i))} ${f(p.getY(i))} ${f(p.getZ(i))}\n`;
        if(uv)for(let i=0;i<uv.count;i++)text+=`vt ${f(uv.getX(i))} ${f(uv.getY(i))}\n`;
        if(n)for(let i=0;i<n.count;i++)text+=`vn ${f(n.getX(i))} ${f(n.getY(i))} ${f(n.getZ(i))}\n`;
        const groups=geo.groups.length?geo.groups:[{start:0,count:geo.index.count,materialIndex:0}];
        for(const group of groups){
          const sub=new THREE.BufferGeometry();for(const [k,a] of Object.entries(geo.attributes))sub.setAttribute(k,a);sub.setIndex(Array.from(geo.index.array.slice(group.start,group.start+group.count)));
          if(groups.length===1)sub.userData={...mesh.geometry.userData};
          const mat=materials[group.materialIndex]||materials[0],color=mat.color.clone().convertLinearToSRGB(),id=`mat_${matIndex++}`;
          mtl+=`newmtl ${id}\nKd ${color.r} ${color.g} ${color.b}\nd ${mat.opacity}\n\n`;text+=`usemtl ${id}\n`;
          const {faces}=quadFaces(sub),ref=i=>{const v=i+1+offset;return uv&&n?`${v}/${v}/${v}`:uv?`${v}/${v}`:n?`${v}//${v}`:`${v}`;};
          for(const face of faces){text+='f '+face.map(ref).join(' ')+'\n';if(face.length===4)quadCount++;else triCount++;}
        }
        offset+=p.count;
      });
      text=`# Codex Design OBJ: ${quadCount} quads, ${triCount} triangles\n`+text;
      const note='OBJ is a baked static pose with quads kept where the topology pairs into quads (GLB/glTF are always triangulated, as engines expect). MTL contains base colors only; PBR textures, bones and animation require GLB/glTF. Units: meters; up: Y.\n';
      return {data:zipSync({'model.obj':strToU8(text),'materials.mtl':strToU8(mtl),'README.txt':strToU8(note)}),extension:'obj.zip',mime:'application/zip'};
    } finally {
      // Cloned materials may share original textures; only dispose owned geometry and materials here.
      baked.traverse(o=>{o.geometry?.dispose();for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean))m.dispose();});
    }
  }
  throw new Error(`Unsupported export: ${format}`);
}
export function download(data,name,mime='application/octet-stream') {
  const url=URL.createObjectURL(new Blob([data],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
