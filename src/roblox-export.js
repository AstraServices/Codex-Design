import { installAnimations } from './roblox-install.js';
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { zipSync, strToU8 } from 'fflate';

// One shared joint palette, world-space bind vertices, identity mesh nodes. Roblox
// otherwise creates independent partial skeletons for fins/teeth/material primitives.
export function prepareRoblox(root,clips=[]) {
  for(const clip of clips)for(const t of clip.tracks){
    const property=THREE.PropertyBinding.parseTrackName(t.name).propertyName;
    if(property==='scale'&&Array.from(t.values).every(v=>Math.abs(v-1)<1e-6))continue;
    if(!['position','quaternion'].includes(property))throw new Error(`${clip.name}: ${property} animation cannot be represented by Roblox Bone transforms; author translation/rotation equivalents`);
  }
  let copy=clone(root);const scene=new THREE.Scene();scene.add(copy);scene.updateMatrixWorld(true);
  // Rigid object/group animation must become a real joint for Studio's Animator.
  const targets=new Set(clips.flatMap(c=>c.tracks.map(t=>THREE.PropertyBinding.parseTrackName(t.name).nodeName)));
  for(const name of targets){
    const node=THREE.PropertyBinding.findNode(copy,name);
    if(!node)throw new Error(`Roblox animation target missing: ${name}; use stable names rather than UUID tracks`);
    if(node.isBone)continue;
    if(node.isSkinnedMesh)throw new Error(`${name}: animate bones rather than the SkinnedMesh transform`);
    const joint=new THREE.Bone();joint.name=node.name;joint.position.copy(node.position);joint.quaternion.copy(node.quaternion);joint.scale.copy(node.scale);
    const parent=node.parent;parent.add(joint);
    if(node.isMesh){node.name+='_Geometry';node.position.set(0,0,0);node.quaternion.identity();node.scale.set(1,1,1);joint.add(node);}
    else{while(node.children.length)joint.add(node.children[0]);node.removeFromParent();if(node===copy)copy=joint;}
  }
  scene.updateMatrixWorld(true);
  const bones=[],meshes=[],inverses=new Map();
  copy.traverse(o=>{if(o.isBone)bones.push(o);if(o.isMesh)meshes.push(o);});
  const boneParent=b=>{for(let p=b.parent;p;p=p.parent)if(p.isBone)return p;return null;};
  if(bones.filter(b=>!boneParent(b)).length>1&&!copy.isBone){
    const common=new THREE.Bone();common.copy(copy,false);common.name=copy.name;
    while(copy.children.length)common.add(copy.children[0]);copy.removeFromParent();scene.add(common);copy=common;bones.unshift(common);scene.updateMatrixWorld(true);
  }
  const names=new Set();
  for(const b of bones){if(!b.name||names.has(b.name))throw new Error('Roblox requires unique, nonempty bone names');names.add(b.name);}
  for(const m of meshes)if(m.isSkinnedMesh)for(let i=0;i<m.skeleton.bones.length;i++){
    const b=m.skeleton.bones[i],inv=m.skeleton.boneInverses[i];
    if(!bones.includes(b))throw new Error(`${m.name}: joint outside asset`);
    const old=inverses.get(b);
    if(old&&old.elements.some((v,j)=>Math.abs(v-inv.elements[j])>1e-5))throw new Error(`${b.name}: inconsistent bind poses across meshes; bind every mesh before posing the rig`);
    inverses.set(b,inv.clone());
  }
  for(const b of bones)if(!inverses.has(b))inverses.set(b,b.matrixWorld.clone().invert());
  // Restore bind transforms, rather than exporting an arbitrary display pose as rest.
  const rest=new Map(bones.map(b=>[b,inverses.get(b).clone().invert()]));
  for(const b of bones){const parent=rest.get(b.parent)||b.parent.matrixWorld;new THREE.Matrix4().copy(parent).invert().multiply(rest.get(b)).decompose(b.position,b.quaternion,b.scale);b.updateMatrix();}
  scene.updateMatrixWorld(true);
  for(const m of meshes){
    let rigid;for(let p=m.parent;p;p=p.parent)if(p.isBone){rigid=p;break;}
    if(!m.isSkinnedMesh&&!rigid)continue;
    if(m.isInstancedMesh)throw new Error(`${m.name}: expand bone-parented instances before Roblox export`);
    const g=m.geometry.clone(),bind=m.isSkinnedMesh?m.bindMatrix.clone():m.matrixWorld.clone();
    if(bind.determinant()<=0)throw new Error(`${m.name}: reflected/singular bind transform; author without negative scale`);
    g.applyMatrix4(bind);
    const count=g.attributes.position.count,ids=new Uint16Array(count*4),weights=new Float32Array(count*4);
    for(let i=0;i<count;i++)for(let j=0;j<4;j++){
      const w=m.isSkinnedMesh?g.attributes.skinWeight.getComponent(i,j):(j===0?1:0);
      const b=m.isSkinnedMesh?m.skeleton.bones[g.attributes.skinIndex.getComponent(i,j)]:rigid;
      if(!Number.isFinite(w)||w<0||(w>0&&!b))throw new Error(`${m.name}: invalid skin weights`);
      ids[i*4+j]=w>0?bones.indexOf(b):0;weights[i*4+j]=w;
    }
    g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(ids,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
    const skin=m.isSkinnedMesh?m:new THREE.SkinnedMesh(g,m.material);
    if(skin!==m){skin.name=m.name;skin.userData=structuredClone(m.userData);skin.visible=m.visible;while(m.children.length)skin.add(m.children[0]);m.removeFromParent();}
    skin.geometry=g;scene.add(skin);skin.position.set(0,0,0);skin.quaternion.identity();skin.scale.set(1,1,1);skin.updateMatrix();
    skin.bind(new THREE.Skeleton(bones,bones.map(b=>inverses.get(b).clone())),new THREE.Matrix4());skin.normalizeSkinWeights();
  }
  scene.updateMatrixWorld(true);return scene;
}

const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const prop=(tag,name,value)=>`<${tag} name="${name}">${value}</${tag}>`;
let referent=0;
const item=(type,name,props='',children='')=>`<Item class="${type}" referent="RBX${++referent}"><Properties>${prop('string','Name',xml(name))}${props}</Properties>${children}</Item>`;
function cframe(m,scale){const e=m.elements;return `<CoordinateFrame name="CFrame"><X>${e[12]*scale}</X><Y>${e[13]*scale}</Y><Z>${e[14]*scale}</Z>${[0,1,2].flatMap(r=>[0,1,2].map(c=>`<R${r}${c}>${e[c*4+r]}</R${r}${c}>`)).join('')}</CoordinateFrame>`;}

// Studio-native editable saves, independent of the 3D Importer's clip handling.
export function animationSaves(scene,clips,{fps=30,studMeters=0.28}={}){
  if(!Number.isFinite(studMeters)||studMeters<=0||!Number.isFinite(fps)||fps<=0)throw new Error('Invalid Roblox animation scale/FPS');
  const tree=clone(scene),bones=[];tree.traverse(o=>{if(o.isBone)bones.push(o);});
  const rest=new Map(bones.map(b=>[b,b.matrix.clone()])),mixer=new THREE.AnimationMixer(tree);
  const parentBone=b=>{for(let p=b.parent;p;p=p.parent)if(p.isBone)return p;return null;};
  const pose=b=>item('Pose',b.name,cframe(rest.get(b).clone().invert().multiply(b.matrix),1/studMeters)+prop('float','Weight',1)+prop('token','EasingStyle',0)+prop('token','EasingDirection',0),bones.filter(c=>parentBone(c)===b).map(pose).join(''));
  const sequences=clips.map(clip=>{
    if(clip.tracks.some(t=>/morphTargetInfluences/.test(t.name)||(/\.scale$/.test(t.name)&&Array.from(t.values).some(v=>Math.abs(v-1)>1e-6))))throw new Error(`${clip.name}: Roblox KeyframeSequence cannot represent scale/morph animation`);
    const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const n=Math.max(1,Math.ceil(clip.duration*fps)),frames=[];
    for(let i=0;i<=n;i++){const t=clip.duration*i/n;mixer.setTime(t);tree.updateMatrixWorld(true);frames.push(item('Keyframe','Keyframe',prop('float','Time',t),bones.filter(b=>!parentBone(b)).map(pose).join('')));}
    mixer.stopAllAction();return item('KeyframeSequence',clip.name,prop('bool','Loop',clip.userData?.loop===true)+prop('token','Priority',clip.userData?.priority??0),frames.join(''));
  }).join('');
  return `<?xml version="1.0" encoding="utf-8"?><roblox version="4">${item('Folder','AnimSaves','',sequences)}</roblox>`;
}

const dataBytes=uri=>{if(!/^data:.*;base64,/.test(uri))throw new Error('Expected embedded export resource');return Uint8Array.from(atob(uri.slice(uri.indexOf(',')+1)),c=>c.charCodeAt(0));};
// Prepared Roblox scenes have identical bind palettes. Emit one glTF skin object
// as well, so importers need not infer that duplicate skin definitions are shared.
export function sharedRobloxSkin(exporter){
  return exporter.register(writer=>({name:'CodexRobloxSkin',afterParse(){
    const doc=writer.json;if(!doc.skins?.length)return;
    const first=doc.skins[0],key=JSON.stringify(first.joints);
    if(doc.skins.some(s=>JSON.stringify(s.joints)!==key||s.skeleton!==first.skeleton))throw new Error('Roblox export expected one canonical joint palette');
    doc.skins=[first];for(const node of doc.nodes)if(node.skin!==undefined)node.skin=0;
  }}));
}
// Roblox does not consistently apply KHR_texture_transform. Bake the common
// material transform into UV0, including material seams, without changing weights.
export function bakeRobloxUVs(scene){
  const keys=['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'];
  const materials=new Map(),textures=new Map();
  const preparedMaterial=m=>{
    if(materials.has(m))return materials.get(m);
    const out=m.clone();
    for(const key of keys)if(m[key]){
      if(!textures.has(m[key])){const t=m[key].clone();t.offset.set(0,0);t.repeat.set(1,1);t.rotation=0;t.center.set(0,0);t.matrixAutoUpdate=true;t.updateMatrix();textures.set(m[key],t);}
      out[key]=textures.get(m[key]);
    }
    materials.set(m,out);return out;
  };
  scene.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    if(!mats.some(m=>keys.some(k=>m[k])))return;
    const g=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone(),uv=g.attributes.uv;
    if(!uv)throw new Error(`${mesh.name}: textured mesh has no UV0`);
    const groups=g.groups.length?g.groups:[{start:0,count:uv.count,materialIndex:0}];
    for(const group of groups){
      const m=mats[group.materialIndex||0]||mats[0],maps=keys.map(k=>m[k]).filter(Boolean);
      if(!maps.length)continue;
      for(const t of maps){t.updateMatrix();if(t.channel!==0)throw new Error(`${mesh.name}: Roblox export needs maps on UV0; bake UV channels first`);}
      const ref=maps[0];
      if(maps.some(t=>t.matrix.elements.some((v,i)=>Math.abs(v-ref.matrix.elements[i])>1e-6)))throw new Error(`${mesh.name}: texture maps use different UV transforms; bake them to a shared atlas before Roblox export`);
      for(let i=group.start;i<group.start+group.count;i++){const v=new THREE.Vector2(uv.getX(i),uv.getY(i)).applyMatrix3(ref.matrix);uv.setXY(i,v.x,v.y);}
    }
    mesh.material=mats.map(preparedMaterial);
    g.userData={...mesh.geometry.userData};mesh.geometry=g;
    if(mats.length===1)mesh.material=mesh.material[0];
  });
}
export async function robloxPackage(scene,clips,exporter,{name='Asset',studMeters=0.28}={}){
  const doc=await sharedRobloxSkin(exporter).parseAsync(scene,{binary:false,animations:clips,trs:true,onlyVisible:true});
  const files={},images=[];
  for(let i=0;i<(doc.buffers||[]).length;i++){const b=doc.buffers[i],file=`buffers/buffer-${i}.bin`;files[file]=dataBytes(b.uri);b.uri=file;}
  for(let i=0;i<(doc.images||[]).length;i++){const im=doc.images[i],ext=im.mimeType==='image/jpeg'?'jpg':'png',file=`textures/image-${i}.${ext}`;files[file]=dataBytes(im.uri);im.uri=file;images[i]=file;}
  const texPath=info=>info?images[doc.textures[info.index].source]:null;
  const materials=(doc.materials||[]).map((m,i)=>({index:i,name:m.name||`Material${i}`,ColorMap:texPath(m.pbrMetallicRoughness?.baseColorTexture),NormalMap:texPath(m.normalTexture),ORM:texPath(m.pbrMetallicRoughness?.metallicRoughnessTexture),baseColorFactor:m.pbrMetallicRoughness?.baseColorFactor||[1,1,1,1],roughness:m.pbrMetallicRoughness?.roughnessFactor??1,metalness:m.pbrMetallicRoughness?.metallicFactor??1}));
  // SurfaceAppearance requires separate grayscale maps, not the glTF G/B packing.
  for(const mat of materials)if(mat.ORM){const blob=new Blob([files[mat.ORM]],{type:'image/png'}),bitmap=await createImageBitmap(blob),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);const src=ctx.getImageData(0,0,c.width,c.height);
    for(const [key,channel,factor] of [['RoughnessMap',1,mat.roughness],['MetalnessMap',2,mat.metalness]]){const dst=ctx.createImageData(c.width,c.height);for(let p=0;p<src.data.length;p+=4){const v=Math.round(src.data[p+channel]*factor);dst.data.set([v,v,v,255],p);}ctx.putImageData(dst,0,0);const file=`textures/material-${mat.index}-${key}.png`;files[file]=dataBytes(c.toDataURL());mat[key]=file;}bitmap.close();}
  const manifest={name,studMeters,importScaleStudsPerMeter:1/studMeters,materials,meshes:(doc.nodes||[]).filter(n=>n.mesh!==undefined).map(n=>({name:n.name,primitives:doc.meshes[n.mesh].primitives.map(p=>({material:p.material}))})),animations:clips.map(c=>({name:c.name,duration:c.duration})),notes:['Import at the documented scale. Animation translations in AnimSaves use this scale.','Common texture transforms are baked into UV0.']};
  files['model.gltf']=strToU8(JSON.stringify(doc));files['manifest.json']=strToU8(JSON.stringify(manifest,null,2));
  files['AnimSaves.rbxmx']=strToU8(animationSaves(scene,clips,{studMeters}));
  files['InstallAnimSaves.lua']=strToU8(installAnimations);
  files['README.txt']=strToU8(`Codex Design Roblox package: ${name}\n1. Extract this ZIP, keeping textures/ and buffers/ next to model.gltf. Import model.gltf with Studio File > Import. Enable texture upload; use the intended account/group.\n2. Units: meters. Match ${1/studMeters} Roblox studs per meter (1 stud = ${studMeters} m). Do not apply automatic avatar scaling to a creature.\n3. In Studio insert AnimSaves.rbxmx (Insert from File), select its AnimSaves folder together with the imported rig Model, run InstallAnimSaves.lua in Command Bar. Open the rig in Animation Editor and load a saved clip. Alternatively import model.gltf through Animation Editor's file importer. A model import does not promise an AnimSaves folder.\n4. If textures are missing, upload the PNGs in textures/ through Asset Manager. manifest.json maps each mesh primitive to its material and ColorMap/NormalMap/RoughnessMap/MetalnessMap. Assign image asset IDs to SurfaceAppearance on the corresponding MeshParts. ORM is a packed glTF image; use the split maps for SurfaceAppearance. Respect baseColorFactor when assigning colors manually.\n5. Publishing an Animation asset still requires Studio and the correct owner permissions. These local files do not invent asset IDs or publish anything.\n6. Inspect skin rest pose, teeth/fins, every clip, and textures in Studio. This package cannot bypass moderation, account permissions or importer defects.\n`);
  return {data:zipSync(files),extension:'roblox.zip',mime:'application/zip'};
}
