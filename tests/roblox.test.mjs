import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { createKit, inspectAsset, THREE } from '../src/kit.js';
import { decodePNG } from '../src/png.js';
import { normalizeHighlight, collectHighlights, bakeHighlightShells, highlightsToLuau, tagHighlightExtensions, restoreImportedHighlights, rgb, lua } from '../src/highlight.js';
import { bakeEdgeGeometry, edgeLineGeometry, edgeLuauDefinitions, collectEdges } from '../src/edges.js';
import { robloxMaterial, ROBLOX_MATERIALS, studMaps, findAssets, traceAlpha, smoothstep } from '../src/textures.js';

async function build(id){const meta=JSON.parse(await readFile(new URL(`../projects/${id}.json`,import.meta.url)));const k=createKit(meta.parameters);await(await import(`../projects/${meta.module}`)).build(k);return k;}

test('PNG decoder reads library icons with alpha',async()=>{
  const png=decodePNG(await readFile(new URL('../assets/library/gvesster-icon-pack-v6/Currency/Coin/256w/Golden Coin 256px.png',import.meta.url)),b=>inflateSync(b));
  assert.equal(png.width,256);let opaque=0,clear=0;for(let i=3;i<png.data.length;i+=4){if(png.data[i]>200)opaque++;if(png.data[i]<10)clear++;}
  assert.ok(opaque>10000&&clear>5000);
});
test('smoothstep uses GLSL argument order and generated materials are not black',()=>{
  assert.equal(smoothstep(0,1,0.5),0.5);assert.equal(smoothstep(1,0,0),1);
  for(const name of ROBLOX_MATERIALS){const m=robloxMaterial(name);if(!m.map)continue;const d=m.map.image.data;let s=0;for(let i=0;i<d.length;i+=4)s+=d[i];assert.ok(s/(d.length/4)>100,`${name} detail map too dark`);}
  const studs=studMaps({style:'studs'});assert.ok(studs.normalMap.image.data.some((v,i)=>i%4===0&&Math.abs(v-128)>20),'stud normal map has relief');
});
test('marching squares traces a square with a hole as two loops',()=>{
  const w=12,h=12,a=new Float32Array(w*h);for(let y=1;y<11;y++)for(let x=1;x<11;x++)a[y*w+x]=(x>3&&x<8&&y>3&&y<8)?0:1;
  assert.equal(traceAlpha(a,w,h).length,2);
});
test('asset index finds icons and the excluded opaque stud texture stays out',async()=>{
  const coins=await findAssets('golden coin',{kind:'icon',limit:3});assert.ok(coins.length&&/Coin/.test(coins[0].path));
  assert.equal((await findAssets('kek universal',{limit:5})).filter(a=>a.path.endsWith('kek_universal.png')).length,0);
});
test('stud shrine: studded parts, icon badge, highlights and edge outlines build in Node',async()=>{
  const k=await build('stud-shrine'),s=inspectAsset(k.root,k.clips);
  assert.deepEqual(s.warnings,[]);assert.equal(s.highlights,3);assert.equal(s.edgeOutlines,6);assert.ok(s.textures>5);
  const coin=k.root.getObjectByName('Coin');assert.ok(coin.geometry.attributes.position.count>200,'icon silhouette was extruded');assert.equal(coin.material.length,2);
  const base=k.root.getObjectByName('Baseplate');assert.deepEqual(base.geometry.groups.map(g=>g.materialIndex),[1,1,0,2,1,1]);
  assert.ok(base.geometry.attributes.uv.array.some(v=>v>15),'UVs are in stud units');
});
test('Roblox Highlight keys normalize to the shared schema',()=>{
  const h=normalizeHighlight({FillColor:[255,0,0],FillTransparency:1,OutlineColor:'white',OutlineTransparency:0.25,DepthMode:'Occluded'});
  assert.equal(h.fillColor,'#ff0000');assert.equal(h.outlineColor,'#ffffff');assert.equal(h.fillTransparency,1);assert.equal(h.depthMode,'Occluded');assert.equal(h.glow,0);
  assert.throws(()=>normalizeHighlight({fillStyle:'zigzag'}));
});
test('baked highlight shells follow the skeleton and carry Roblox-ready names',async()=>{
  const k=await build('kelp');k.highlight('SoftBody',{fillColor:'#ff0000',fillTransparency:0.5,outlineColor:'#ffffff'});
  assert.equal(bakeHighlightShells(k.root),2);
  const outline=k.root.getObjectByName('SoftBody_HighlightOutline'),body=k.root.getObjectByName('SoftBody');
  assert.ok(outline.isSkinnedMesh);assert.equal(outline.skeleton,body.skeleton);assert.ok(outline.material.isMeshBasicMaterial);
  // Inverted hull: every outline vertex lies outside the source surface.
  const p=outline.geometry.attributes.position,q=body.geometry.attributes.position;let farther=0;for(let i=0;i<p.count;i+=37){const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(q,i);if(Math.hypot(a.x,a.z)>=Math.hypot(b.x,b.z)-1e-6)farther++;}
  assert.ok(farther>0);assert.equal(collectHighlights(k.root).length,1,'shells are not themselves highlighted');
});
test('edge outline bakes 12 crease strips for a box and skips smooth spheres',()=>{
  const box=edgeLineGeometry(new THREE.BoxGeometry(1,1,1),30,0.02);assert.equal(box.index.count,12*36);
  const sphere=edgeLineGeometry(new THREE.SphereGeometry(1,24,16),30,0.02);assert.equal(sphere.index.count,0);
  const root=new THREE.Group(),m=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial());m.name='Crate';root.add(m);
  m.userData.codexEdges={enabled:true,color:'#000000',transparency:0,thickness:2,creaseAngle:30,silhouette:true,creases:true,depthMode:'Occluded',fill:false,fillColor:'#fff',fillTransparency:0.6,worldThickness:null,name:'CrateEdges'};
  assert.equal(bakeEdgeGeometry(root),2);assert.ok(root.getObjectByName('Crate_EdgeLines'));assert.ok(root.getObjectByName('Crate_EdgeSilhouette'));
});
test('settings survive the glTF extension round trip and Luau lists every shell',async()=>{
  const k=await build('stud-shrine');tagHighlightExtensions(k.root);
  const pickup=k.root.getObjectByName('Pickup'),ext=pickup.userData.gltfExtensions.CODEX_highlight;assert.equal(ext.outlineColor,'#ffffff');
  delete pickup.userData.codexHighlight;restoreImportedHighlights(k.root);assert.equal(pickup.userData.codexHighlight.fillColor,'#ffcc33');
  const luau=highlightsToLuau(k.root,'stud-shrine',edgeLuauDefinitions(k.root,'stud-shrine',rgb,lua));
  for(const name of ['Coin_HighlightOutline','GemCore_HighlightFill','Pedestal_EdgeLines','Pillar3_EdgeSilhouette'])assert.match(luau,new RegExp(name));
  assert.match(luau,/function CodexOutline\.Setup/);assert.equal((luau.match(/Kind = "Edges"/g)||[]).length,collectEdges(k.root).length);
});
