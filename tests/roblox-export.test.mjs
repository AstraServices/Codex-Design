import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createKit} from '../src/kit.js';
import {prepareRoblox,bakeRobloxUVs,animationSaves} from '../src/roblox-export.js';
import {normalizeExportMaterials} from '../src/exporters.js';

const sample=m=>{m.skeleton?.update();return m.getVertexPosition(0,new T.Vector3()).applyMatrix4(m.matrixWorld);};
test('partial palettes and rigid teeth share a canonical rig without changing animated world positions',()=>{
  const k=createKit(),stage=k.group('Stage',{rotate:[0,Math.PI,0],at:[1,2,3]}),root=k.bone('Root',{parent:stage,at:[0,1,0]}),jaw=k.bone('Jaw',{parent:root,at:[0,0,2]});
  const body=k.skin('Body',new T.BoxGeometry(),k.material(),[root,jaw],()=>[[0,.4],[1,.6]],{parent:stage});
  const fin=k.skin('Fin',new T.BoxGeometry(),k.material(),[jaw],()=>[[0,1]],{parent:stage});
  const tooth=k.mesh('Tooth','box',[.2,.4,.2],k.material(),{parent:jaw,at:[0,1,0]});
  k.clip('Bite',1,[k.rotation(jaw,[0,1],[[0,0,0],[.6,0,0]])]);
  const out=prepareRoblox(k.root,k.clips),a=new T.AnimationMixer(k.root),b=new T.AnimationMixer(out);
  a.clipAction(k.clips[0]).play();b.clipAction(k.clips[0]).play();
  for(const t of [0,.3,.8]){a.setTime(t);b.setTime(t);k.root.updateMatrixWorld(true);out.updateMatrixWorld(true);for(const m of [body,fin,tooth])assert.ok(sample(m).distanceTo(sample(out.getObjectByName(m.name)))<1e-5);}
  for(const name of ['Body','Fin','Tooth']){const m=out.getObjectByName(name);assert.equal(m.skeleton.bones.length,2);assert.ok(m.bindMatrix.equals(new T.Matrix4()));assert.equal(m.parent,out);}
  assert.equal(tooth.isSkinnedMesh,undefined);
});
test('rigid animated groups are promoted to joints, with editable sampled deltas',()=>{
  const k=createKit(),lid=k.group('Lid',{at:[0,2,0]});k.mesh('Cap','box',[1,1,1],k.material(),{parent:lid});
  k.clip('Open',1,[k.track(lid,'position',[0,1],[[0,2,0],[0,3,0]])]);
  const scene=prepareRoblox(k.root,k.clips);assert.ok(scene.getObjectByName('Lid').isBone);assert.ok(scene.getObjectByName('Cap').isSkinnedMesh);
  const saves=animationSaves(scene,k.clips,{fps:1,studMeters:.5});assert.match(saves,/<Y>2<\/Y>/);assert.equal((saves.match(/class="Keyframe"/g)||[]).length,2);
});
test('UV transforms bake per material and keep weights and original texture intact',()=>{
  const k=createKit(),texture=new T.Texture();texture.repeat.set(4,4);texture.offset.set(.25,.5);const m=k.mesh('Part','box',[1,1,1],k.material('#ffffff',{map:texture}));
  const scene=prepareRoblox(k.root),g=m.geometry,expected=new T.Vector2().fromBufferAttribute(g.attributes.uv,0);texture.updateMatrix();expected.applyMatrix3(texture.matrix);
  bakeRobloxUVs(scene);const out=scene.getObjectByName('Part');assert.ok(new T.Vector2().fromBufferAttribute(out.geometry.attributes.uv,0).distanceTo(expected)<1e-6);assert.equal(out.material.map.repeat.x,1);assert.equal(texture.repeat.x,4);assert.equal(m.geometry,g);
});
test('incompatible bind poses and map transforms fail explicitly',()=>{
  const k=createKit(),b=k.bone('Root');k.skin('A',new T.BoxGeometry(),k.material(),[b],()=>[[0,1]]);b.position.x=1;k.skin('B',new T.BoxGeometry(),k.material(),[b],()=>[[0,1]]);assert.throws(()=>prepareRoblox(k.root),/inconsistent bind poses/);
  const t1=new T.Texture(),t2=new T.Texture();t2.repeat.set(2,2);const p=createKit();p.mesh('Part','box',[1,1,1],p.material('#fff',{map:t1,normalMap:t2}));assert.throws(()=>bakeRobloxUVs(prepareRoblox(p.root)),/different UV transforms/);
});
test('brightened HDR base colors become valid glTF factors without altering authoring materials',()=>{
  const k=createKit(),mat=k.material();mat.color.setRGB(2.4,.5,-.1);const mesh=k.mesh('Bright','box',[1,1,1],mat);
  const out=prepareRoblox(k.root);assert.equal(normalizeExportMaterials(out).length,1);assert.deepEqual(out.getObjectByName('Bright').material.color.toArray(),[1,.5,0]);assert.deepEqual(mesh.material.color.toArray(),[2.4,.5,-.1]);
});
test('multiple animated branches get a common skeleton ancestor and save both branches',()=>{
  const k=createKit(),a=k.group('Left',{at:[-1,0,0]}),b=k.group('Right',{at:[1,0,0]});
  for(const [name,parent] of [['LeftPart',a],['RightPart',b]])k.mesh(name,'box',[1,1,1],k.material(),{parent});
  k.clip('Open',1,[k.rotation(a,[0,1],[[0,0,0],[0,1,0]]),k.rotation(b,[0,1],[[0,0,0],[0,-1,0]])]);
  const out=prepareRoblox(k.root,k.clips),left=out.getObjectByName('LeftPart');assert.equal(left.skeleton.bones[0].name,'Asset');assert.equal(left.skeleton.bones.length,3);
  const saves=animationSaves(out,k.clips,{fps:1});for(const n of ['Left','Right'])assert.ok(saves.includes(`>${n}</string>`));
});
