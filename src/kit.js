import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { quadSurface, auditTopology, optimizeTopology } from './topology.js';
import * as tex from './textures.js';
import { setHighlight, collectHighlights, inspectHighlights } from './highlight.js';
import { setEdges, collectEdges } from './edges.js';
import { optimizeLOD } from './lod.js';
import { analyzeQuality, fixTopology, smartTopology } from './topology-quality.js';
import { bakeQuads, boxQuads, voxelQuads, rgb01 } from './bake.js';
import { vertexAO } from './paint.js';
import { rebakeSurface, initSurface } from './surface.js';
import { LOOK_DEFAULTS, LOOK_NAMES, LIGHT_DEFAULTS, compileGradient } from './look.js';
import * as texlab from './texlab.js';
import { topologyOptimize, TOPOLOGY_CASES, densityMesh } from './topopt.js';
import { pbrSurface, PBR_EXAMPLE_NAMES } from './pbr.js';

export { THREE };
export function createKit(parameters = {}) {
  const root = new THREE.Group(); root.name = 'Asset';
  const clips = [], names = new Set(['Asset']);
  function named(object,name) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) || names.has(name)) throw new Error(`Unique track-safe name required: ${name}`);
    names.add(name); object.name=name; return object;
  }
  function place(object,options={}) {
    if (options.at) object.position.fromArray(options.at);
    if (options.rotate) object.rotation.fromArray([...options.rotate,'XYZ']);
    if (options.scale) object.scale.fromArray(typeof options.scale==='number'?[options.scale,options.scale,options.scale]:options.scale);
    (options.parent||root).add(object); return object;
  }
  const material = (color='#e3a45c',options={}) => new THREE.MeshStandardMaterial({color,roughness:0.38,metalness:0.15,...options});
  function geometry(type,args=[]) {
    switch(type) {
      case 'box': return new THREE.BoxGeometry(...args);
      case 'roundedBox': return new RoundedBoxGeometry(...args);
      case 'sphere': return new THREE.SphereGeometry(...args);
      case 'cylinder': return new THREE.CylinderGeometry(...args);
      case 'cone': return new THREE.ConeGeometry(...args);
      case 'torus': return new THREE.TorusGeometry(...args);
      case 'capsule': return new THREE.CapsuleGeometry(...args);
      case 'icosahedron': return new THREE.IcosahedronGeometry(...args);
      case 'lathe': return new THREE.LatheGeometry(args[0].map(p=>new THREE.Vector2(...p)),args[1]??48);
      case 'tube': return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(args[0].map(p=>new THREE.Vector3(...p))),args[1]??64,args[2]??0.08,args[3]??12,args[4]??false);
      case 'extrude': {
        const shape = new THREE.Shape(args[0].map(p=>new THREE.Vector2(...p)));
        return new THREE.ExtrudeGeometry(shape,{depth:0.2,bevelEnabled:true,bevelSize:0.04,bevelThickness:0.04,bevelSegments:3,...args[1]});
      }
      default: throw new Error(`Unknown geometry ${type}; pass a THREE.BufferGeometry for custom surfaces.`);
    }
  }
  function mesh(name,type,args,mat,options={}) {
    const object=named(new THREE.Mesh(type?.isBufferGeometry?type:geometry(type,args),mat||material()),name);
    object.castShadow=object.receiveShadow=true; return place(object,options);
  }
  function group(name,options={}) {return place(named(new THREE.Group(),name),options);}
  function bone(name,options={}) {return place(named(new THREE.Bone(),name),options);}
  function csg(name,a,b,operation='subtract') {
    if (![a,b].every(m=>m.isMesh && !m.isSkinnedMesh && !Array.isArray(m.material))) throw new Error('CSG requires two static, single-material meshes');
    root.updateMatrixWorld(true);
    const brushes=[a,b].map(m=>{const g=m.geometry.clone().applyMatrix4(m.matrixWorld);g.clearGroups(); return new Brush(g,m.material);});
    brushes.forEach(b=>b.updateMatrixWorld(true));
    const evaluator = new Evaluator(); evaluator.useGroups=true;
    const op={subtract:SUBTRACTION,union:ADDITION,intersect:INTERSECTION}[operation];
    if(op===undefined) throw new Error(`Unknown CSG operation: ${operation}`);
    const result=evaluator.evaluate(...brushes,op);
    a.removeFromParent(); b.removeFromParent();
    brushes.forEach(b=>{b.geometry.dispose();});
    return mesh(name,result.geometry,null,result.material);
  }
  // Geometry and bones share bind space. Return up to four [boneIndex,weight] pairs per vertex.
  function skin(name,geo,mat,bones,weights,options={}) {
    const indices=[], values=[], p=new THREE.Vector3();
    for(let i=0;i<geo.attributes.position.count;i++) {
      p.fromBufferAttribute(geo.attributes.position,i);
      const influences=weights(p,i);
      if (!influences?.length || influences.length>4) throw new Error('Expected 1–4 skin influences');
      let sum=0;
      for(const [index,weight] of influences) {
        if(!Number.isInteger(index)||index<0||index>=bones.length||!Number.isFinite(weight)||weight<0) throw new Error('Invalid skin influence');
        sum+=weight;
      }
      if(sum<=0) throw new Error('Skin weights must sum above zero');
      for(let j=0;j<4;j++){const weight=(influences[j]?.[1]??0)/sum;indices.push(weight>0?influences[j][0]:0);values.push(weight);}
    }
    geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
    geo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(values,4));
    const object=place(named(new THREE.SkinnedMesh(geo,mat),name),options);
    object.castShadow=object.receiveShadow=true; object.frustumCulled=false;
    root.updateMatrixWorld(true); object.bind(new THREE.Skeleton(bones)); return object;
  }
  function clip(name,duration,tracks) {
    if(clips.some(c=>c.name===name)) throw new Error(`Duplicate animation: ${name}`);
    const c=new THREE.AnimationClip(name,duration,tracks);
    if(!c.validate()) throw new Error(`Invalid animation: ${name}`);
    clips.push(c); return c;
  }
  function track(target,property,times,values) {
    const object=typeof target==='string'?root.getObjectByName(target):target;
    if(!object) throw new Error(`Animation target missing: ${target}`);
    const classes={position:THREE.VectorKeyframeTrack,scale:THREE.VectorKeyframeTrack,quaternion:THREE.QuaternionKeyframeTrack,morphTargetInfluences:THREE.NumberKeyframeTrack};
    const Track=classes[property]; if(!Track) throw new Error(`Unsupported track: ${property}`);
    return new Track(`${object.name}.${property}`,times,values.flat());
  }
  const rotation = (target,times,eulers) => track(target,'quaternion',times,eulers.map(e=>new THREE.Quaternion().setFromEuler(new THREE.Euler(...e)).toArray()));
  function sample(target,property,duration,fps,fn) {
    const n=Math.max(1,Math.ceil(duration*fps)), times=[], values=[];
    for(let i=0;i<=n;i++){const t=duration*i/n;times.push(t);values.push(fn(t));}
    return property==='rotation'?rotation(target,times,values):track(target,property,times,values);
  }
  // ---------- Roblox Highlight ----------
  const resolve=target=>{const object=typeof target==='string'?(target==='Asset'?root:root.getObjectByName(target)):target;if(!object)throw new Error(`Highlight adornee missing: ${target}`);return object;};
  /** Roblox Highlight on an object and its descendants. Accepts FillColor/FillTransparency/OutlineColor/OutlineTransparency/DepthMode/Enabled (or camelCase). */
  const highlight=(target,settings={})=>setHighlight(resolve(target),settings);
  /** Edge Outline: lines on silhouette + hard edges (Roblox part-outline look). Fill off by default. Baked into GLB/glTF as geometry. */
  const edges=(target,settings={})=>setEdges(resolve(target),settings);
  // ---------- Textures, studs, materials, icons ----------
  const memo=new Map(),cached=(key,make)=>{if(!memo.has(key))memo.set(key,make());return memo.get(key);};
  const studMaterial=(color,options={})=>cached('stud|'+color+JSON.stringify(options),()=>tex.studMaterial(color,options));
  const robloxMaterial=(name,options={})=>cached('rbx|'+name+JSON.stringify(options),()=>tex.robloxMaterial(name,options));
  const partMaterials=new Map();
  /** Roblox-style Part: size in meters, studded top / inlet bottom; surface is any Roblox material preset. */
  async function part(name,size,color='#a3a2a5',options={}) {
    // Default top is the StudTrain square stud texture; the round procedural 'studs' only on request.
    const {surface='Plastic',top='train',bottom='inlet',studs='texture',material:override,...placement}=options;
    const geo=await tex.studGeometry(size,{top,bottom,studs});
    const mats=override?(Array.isArray(override)?override:[override,override,override]):await tex.studPartMaterials(color,{surface,top,bottom},partMaterials);
    const object=mesh(name,geo,null,mats,placement);object.userData.robloxPart={size,color,surface,top,bottom};return object;
  }
  /** Apply box-projected UVs so tiling textures keep one UV unit per stud (default) on any size. */
  const worldUV=(target,tile=tex.STUD)=>{const geo=target.isMesh?target.geometry:target;tex.worldUV(geo,tile);return target;};
  /** 3D extruded icon from the bundled packs (query or path). Use sparingly: emblems, pickups, signage. */
  async function iconBadge(name,query,options={}) {
    const {size=1,depth=0.12,bevel=0.015,sideColor,emissive,roughness,metalness,threshold,resolution,...placement}=options;
    const r=await tex.iconBadgeGeometry(query,{size,depth,bevel,sideColor,emissive,roughness,metalness,threshold,resolution});
    const object=mesh(name,r.geometry,null,r.materials,placement);object.userData.asset=r.source;return object;
  }
  /** Flat cutout icon card (double-sided). */
  async function iconPlane(name,query,options={}) {
    const {size=1,emissive,alphaTest,...placement}=options,r=await tex.iconPlaneMaterial(query,{emissive,alphaTest});
    const w=r.aspect>=1?size:size*r.aspect,h=r.aspect>=1?size/r.aspect:size;
    const object=mesh(name,new THREE.PlaneGeometry(w,h),null,r.material,placement);object.castShadow=false;object.userData.asset=r.source;return object;
  }
  /** Project an image onto a static mesh surface. at/normal in world space; spin rotates around the normal. */
  async function decal(name,target,source,options={}) {
    const {at,normal=[0,0,1],size=[0.5,0.5],depth=0.3,spin=0,offset=0.002,...materialOptions}=options,object=resolve(target);
    if(object.isSkinnedMesh)throw new Error('Decals need a static mesh');
    const helper=new THREE.Object3D();helper.position.fromArray(at);helper.lookAt(helper.position.clone().add(new THREE.Vector3(...normal)));helper.rotateZ(spin);
    const map=source?.isTexture?source:await tex.texture(await tex.resolveAsset(source),{wrap:'clamp'});
    const mat=new THREE.MeshStandardMaterial({name:`Decal_${name}`,map,transparent:true,alphaTest:0.05,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,roughness:0.6,...materialOptions});
    return mesh(name,tex.decalGeometry(object,at,helper.rotation.toArray().slice(0,3),[size[0],size[1],depth],offset),null,mat);
  }
  /** Textured PBR material: string sources are bundled-library paths or URLs. */
  async function pbr(options={}) {
    const {map,normalMap,roughnessMap,metalnessMap,aoMap,emissiveMap,alphaMap,repeat,nearest,...rest}=options,load=(src,srgb)=>src===undefined||src?.isTexture?src:tex.texture(src,{srgb,repeat,nearest});
    const [m,n,r,mt,ao,e,a]=await Promise.all([load(map,true),load(normalMap,false),load(roughnessMap,false),load(metalnessMap,false),load(aoMap,false),load(emissiveMap,true),load(alphaMap,false)]);
    return new THREE.MeshStandardMaterial({roughness:0.6,metalness:0,...rest,...(m&&{map:m}),...(n&&{normalMap:n}),...(r&&{roughnessMap:r}),...(mt&&{metalnessMap:mt}),...(ao&&{aoMap:ao}),...(e&&{emissiveMap:e}),...(a&&{alphaMap:a,transparent:true})});
  }
  // ---------- Surface painting: studs, look (rim/glow/vignette/AO), gradients, custom PBR channels ----------
  // Every painted mesh keeps userData.codexSurface so later k.paint / k.gradient calls stack and re-bake.
  const surfaceMeshes=t=>{const out=[];resolve(t).traverse(o=>{if(o.isMesh&&!o.userData.codexHighlightShell&&!o.userData.codexHelper)out.push(o);});return out;};
  const LOOK_KEYS=['look','studs','tessellate','studStrength','studScale','pxPerStud','maxAtlas','roughness','metalness','emissiveIntensity','painter','crease','hardAngle','concaveRims',...Object.keys(LOOK_DEFAULTS)];
  const pick=o=>Object.fromEntries(Object.entries(o).filter(([k,v])=>LOOK_KEYS.includes(k)&&v!==undefined));
  const asList=g=>g===undefined||g===null?[]:Array.isArray(g)?g:[g];
  const withSpace=(g,space)=>{if(g==='light')return {...LIGHT_DEFAULTS,space};if(!g||typeof g!=='object'||Array.isArray(g))throw new Error("Design the gradient yourself: {stops:[[0,'#..'],[1,'#..']], type, from/to|direction|center, mode} (or 'light'); there are no named presets");if(!g.stops&&!g.colors&&g.bottom===undefined&&g.top===undefined&&g.mode!=='light')throw new Error('Gradient needs stops/colors (color gradient) or bottom/top (light gradient)');return {space,...g};};
  const rebake=m=>rebakeSurface(m,root);
  async function surfaceFrom(name,quads,options,placement){
    const object=mesh(name,new THREE.BufferGeometry(),null,material('#ffffff'),placement);
    object.userData.codexSurface={kind:'quads',quads,options:pick(options),gradients:asList(options.gradient).map(g=>withSpace(g,'part'))};
    return rebake(object);
  }
  /** One stud block with the baked look. colors:{right,left,top,bottom,front,back} override faces; gradient: spec(s) you design. */
  async function block(name,size,color='#4caf50',options={}){
    const {colors,at,rotate,scale,parent,...look}=options;
    return surfaceFrom(name,boxQuads(size,color,colors),look,{at,rotate,scale,parent});
  }
  /** Voxel model → one mesh: greedy faces, voxel AO, StudTrain studs on every face, look + gradients in one atlas.
   *  {fill:(x,y,z)=>color|null, size:[nx,ny,nz]} | {cells:[[x,y,z,color]]} | {rows:['..##..'], palette:{'#':'#222'}, depth}; voxel = edge length (m, default 1 stud). */
  async function voxels(name,options={}){
    const {cells:c0,fill,size,rows,palette={},depth=1,voxel=tex.STUD,center=true,merge=true,colorEdges=true,at,rotate,scale,parent,...look}=options,concaveRims=!!options.concaveRims;
    // rows: pixel art (top row first) extruded `depth` voxels along z; palette maps characters to colors ('.'/' ' = empty).
    const cells=rows?rows.flatMap((line,j)=>[...line].flatMap((ch,i)=>palette[ch]?Array.from({length:depth},(_,z)=>[i,rows.length-1-j,z,palette[ch]]):[])).concat(c0??[]):c0;
    const v=voxelQuads({cells,fill,size,voxel,center,merge,colorEdges,concaveRims});
    const object=await surfaceFrom(name,v.quads,look,{at,rotate,scale,parent});object.userData.voxels={cells:v.cells,size:v.size,voxel};return object;
  }
  /** Paint ANY mesh(es): look (rim/glow/vignette), studs, gradients you design, AO, and custom PBR channels via
   *  painter:{albedo(ctx,color),roughness(ctx),metalness(ctx),emissive(ctx),height(ctx),bump}. Converts each mesh to
   *  one atlas texture (skin weights kept). occlusion:true adds ray-traced vertex AO from the whole model. */
  async function paint(target='Asset',options={}){
    const meshes=surfaceMeshes(target),{occlusion,gradient:grad,...rest}=options;
    let occluder=null;
    if(occlusion){
      root.updateMatrixWorld(true);const geos=[];
      root.traverse(o=>{if(o.isMesh&&!o.isSkinnedMesh&&!o.userData.codexHighlightShell){const src=o.userData.codexSurface?.source??o.geometry;if(!src.attributes.position)return;const g=(src.index?src.toNonIndexed():src.clone());for(const key of Object.keys(g.attributes))if(key!=='position')g.deleteAttribute(key);g.applyMatrix4(o.matrixWorld);geos.push(g);}});
      occluder=geos.length?mergeGeometries(geos):null;
    }
    for(const m of meshes){
      let S=m.userData.codexSurface;
      if(!S){if(m.material.map&&!rest.painter?.albedo)console.warn(`paint: ${m.name} had a texture map; the painted atlas replaces it (author it in painter.albedo instead).`);S=initSurface(m);}
      Object.assign(S.options,pick(rest));
      if(rest.colors)S.colors=rest.colors.map(c=>rgb01(c));if(rest.color)S.colors=[rgb01(rest.color)];
      S.gradients.push(...asList(grad).map(g=>withSpace(g,'part')));
      if(occluder&&S.kind==='mesh')S.ao=await vertexAO(S.source,m.matrixWorld,occluder,typeof occlusion==='object'?occlusion:{distance:new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).length()*0.25});
      await rebake(m);
    }
    return meshes.length;
  }
  /** Add a gradient you design (stacks). 'light' = measured model light gradient (dark base → bright top).
   *  Color gradient: {stops:[[0,'#33c3c9'],[1,'#3b1a72']], type:'linear'|'radial'|'spherical'|'angular'|'normal'|'noise'|'edge'|'face',
   *  from:'bottom-left', to:'top-right' | direction | center, radius, space:'model'|'part'|'world',
   *  mode:'replace'|'tint'|'multiply'|'overlay'|'screen'|'soft-light'|'light', amount, ease, curve, steps, repeat,
   *  only:['#2a8e28'] (texels whose base color matches) | where:(ctx)=>bool}.
   *  Plain meshes become painted (look 'flat') so radial and multi-stop gradients are exact, not vertex-limited. */
  async function gradient(target='Asset',spec='light',options={}){
    const meshes=surfaceMeshes(target);
    for(const m of meshes){if(!m.userData.codexSurface)await paint(m,{look:'flat',...options});const S=m.userData.codexSurface;Object.assign(S.options,pick(options));S.gradients.push(withSpace(spec,'model'));await rebake(m);}
    return meshes.length;
  }
  /** Set the look: 'default' (measured), 'flat', or your own object with any LOOK_DEFAULTS key (rim, rimWidth, rimLighten, glow, vignette…, shade(ctx,color), post(ctx,color)). */
  const look=(target,lookSpec,overrides={})=>paint(target,{look:lookSpec,...overrides});
  // ---------- Engineering topology optimization (SIMP) ----------
  /** Runs SIMP topology optimization and extrudes the optimized density field into a solid part.
   *  {case:'cantilever'|'mbb'|'bridge'|'bracket'|'arch' or loads/supports, nelx, nely, volfrac, size (m, long side), thickness, threshold}. */
  function topologyPart(name,options={}){
    const {size=2,thickness=0.2,threshold=0.5,color='#9aa3ad',material:mat,bevel=0.01,mesher='quad',upsample=1,at,rotate,scale,parent,...opt}=options;
    const result=topologyOptimize(opt);
    let geo;
    if(mesher==='quad')geo=densityMesh(result.density,result.nelx,result.nely,{size,thickness,threshold,upsample,THREE}); // quad-dominant, watertight
    else{ // 'extrude': smooth traced outline + bevel (earcut caps, more triangles)
      const {shapes}=tex.fieldShapes(result.density,result.nelx,result.nely,{size,threshold,tolerance:0.25,minArea:2});
      if(!shapes.length)throw new Error('Topology result has no solid region; raise volfrac or lower threshold');
      geo=new THREE.ExtrudeGeometry(shapes,{depth:thickness,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,curveSegments:1});geo.translate(0,0,-thickness/2);
    }
    if(!geo.index?.count&&!geo.attributes.position.count)throw new Error('Topology result has no solid region; raise volfrac or lower threshold');
    const object=mesh(name,geo,null,mat??material(color,{roughness:0.4,metalness:0.6}),{at,rotate,scale,parent});
    object.userData.topologyOptimization={compliance:result.compliance,volume:result.volume,iterations:result.iterations,nelx:result.nelx,nely:result.nely};
    return Object.assign(object,{topology:result});
  }
  return {THREE,root,clips,parameters,material,geometry,mesh,group,bone,skin,csg,clip,track,rotation,sample,mergeGeometries,quadSurface,audit:()=>auditTopology(root),optimize:options=>optimizeTopology(root,options),
    /** Smart QEM LOD in the recipe (persistent): k.lod({reduction:0.5,maxError:0.015,cullDetails:false}). Works on skinned meshes. */
    lod:options=>optimizeLOD(root,options),quality:()=>analyzeQuality(root),fixTopology:options=>fixTopology(root,options),quadify:options=>fixTopology(root,{relax:true,flips:true,quadify:true,...options}),
    /** Context-aware topology: intent 'auto' | 'animation' | 'subdivision' | 'game' | 'print'. Classifies each mesh (deforming / organic / hard-surface) and only adds quads where they matter. */
    smartTopology:(intent='auto',options={})=>smartTopology(root,{intent,...options}),
    highlight,highlights:()=>collectHighlights(root),edges,edgeOutlines:()=>collectEdges(root),
    STUD:tex.STUD,ROBLOX_MATERIALS:tex.ROBLOX_MATERIALS,STUD_STYLES:tex.STUD_STYLES,texture:tex.texture,pixelTexture:tex.pixelTexture,dataTexture:tex.dataTexture,normalFromHeight:tex.normalFromHeight,noise:tex.noise,fbm:tex.fbm,
    pbr,studMaterial,robloxMaterial,part,worldUV,block,voxels,paint,surface:paint,gradient,look,LOOKS:LOOK_NAMES,LOOK_DEFAULTS,rgb01,compileGradient,tex:texlab,topologyOptimize,topologyPart,TOPOLOGY_CASES,pbrSurface:(def,o)=>pbrSurface(def,o),PBR_EXAMPLES:PBR_EXAMPLE_NAMES,iconBadge,iconPlane,decal,findAssets:tex.findAssets,asset:tex.resolveAsset,iconShapes:tex.iconShapes};
}

export function inspectAsset(root,clips=[]) {
  const stats={meshes:0,triangles:0,vertices:0,bones:0,skinnedMeshes:0,materials:0,animations:clips.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.length})),warnings:[]};
  const materials=new Set(),names=new Set();
  root.updateMatrixWorld(true);
  root.traverse(o=>{
    if(names.has(o.name)&&o.name) stats.warnings.push(`Duplicate name: ${o.name}`); names.add(o.name);
    if(o.isBone) stats.bones++;
    if(!o.isMesh) return;
    stats.meshes++; if(o.isSkinnedMesh) stats.skinnedMeshes++;
    const g=o.geometry,p=g.attributes.position;
    stats.vertices+=p.count;stats.triangles+=(g.index?.count??p.count)/3;
    (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m.uuid));
    if(!p.array.every(Number.isFinite)) stats.warnings.push(`Non-finite vertices: ${o.name}`);
    if(o.scale.x*o.scale.y*o.scale.z<0) stats.warnings.push(`Negative scale: ${o.name}`);
  });
  for(const clip of clips) for(const t of clip.tracks){
    const target=THREE.PropertyBinding.parseTrackName(t.name).nodeName;
    if(!root.getObjectByName(target)) stats.warnings.push(`Unbound animation target: ${t.name}`);
  }
  stats.materials=materials.size;
  const textures=new Set();root.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean))for(const v of Object.values(m))if(v?.isTexture)textures.add(v.image??v);});
  stats.textures=textures.size;
  const h=inspectHighlights(root);stats.highlights=h.count;stats.edgeOutlines=collectEdges(root).length;stats.warnings.push(...h.warnings);
  const size=new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());stats.size=size.toArray().map(n=>+n.toFixed(3));
  return stats;
}

export function disposeAsset(root) {
  const geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set();
  root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.skeleton)skeletons.add(o.skeleton);for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean)){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());skeletons.forEach(s=>s.dispose());
}
