import {test,expect} from '@playwright/test';
import {unzipSync,strFromU8} from 'fflate';
import validator from 'gltf-validator';
import {mkdir,writeFile} from 'node:fs/promises';
import {decodePNG} from '../../src/png.js';
import {inflateSync} from 'node:zlib';

test('Roblox package contains usable external PNGs, skin and native editable saves',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/?project=courier');await page.waitForFunction(()=>window.codexDesign?.ready);
  const result=await page.evaluate(async()=>{
    const {createKit}=await import('/src/kit.js'),{encodeAsset}=await import('/src/exporters.js');
    const k=createKit(),b=k.bone('Root'),mat=k.material('#ffffff',{map:k.pixelTexture(8,8,(u,v)=>[u*255,v*255,128],{repeat:4})});
    const orm=k.pixelTexture(8,8,()=>[255,128,64],{repeat:4,srgb:false});mat.roughnessMap=mat.metalnessMap=orm;mat.roughness=mat.metalness=.5;
    k.skin('Body',k.geometry('box',[1,1,1]),mat,[b],()=>[[0,1]]);
    k.clip('Turn',1,[k.rotation(b,[0,1],[[0,0,0],[0,1,0]])]);
    const r=await encodeAsset(k.root,k.clips,'roblox');let s='';for(let i=0;i<r.data.length;i+=32768)s+=String.fromCharCode(...r.data.subarray(i,i+32768));return {base64:btoa(s)};
  });
  const files=unzipSync(Buffer.from(result.base64,'base64')),doc=JSON.parse(strFromU8(files['model.gltf']));
  const manifest=JSON.parse(strFromU8(files['manifest.json']));
  for(const [key,value] of [['RoughnessMap',64],['MetalnessMap',32]]){const png=decodePNG(files[manifest.materials[0][key]],b=>new Uint8Array(inflateSync(b)));expect(png.data[0]).toBe(value);}
  expect(doc.images.length).toBeGreaterThan(0);
  for(const im of doc.images){expect(im.uri).toMatch(/^textures\//);expect([...files[im.uri].slice(0,8)]).toEqual([137,80,78,71,13,10,26,10]);}
  for(const b of doc.buffers)expect(files[b.uri].length).toBe(b.byteLength);
  const report=await validator.validateString(strFromU8(files['model.gltf']),{externalResourceFunction:async uri=>files[uri]});expect(report.issues.numErrors,JSON.stringify(report.issues.messages)).toBe(0);
  expect(doc.skins.length).toBe(1);expect(doc.animations.length).toBe(manifest.animations.length);
  expect(strFromU8(files['AnimSaves.rbxmx'])).toContain('class="KeyframeSequence"');
  expect(strFromU8(files['InstallAnimSaves.lua'])).toContain('Instance.new("ObjectValue")');
  expect(doc.extensionsUsed||[]).not.toContain('KHR_texture_transform');
  await mkdir('work/roblox-package-qa',{recursive:true});
  await writeFile('work/roblox-package-qa/cube-pet.roblox.zip',Buffer.from(result.base64,'base64'));
  // Browser re-import exercises image decoding and actual skeleton binding.
  const checked=await page.evaluate(async base64=>{
    const {unzipSync,strFromU8}=await import('/node_modules/fflate/esm/browser.js');
    const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const files=unzipSync(Uint8Array.from(atob(base64),c=>c.charCodeAt(0))),d=JSON.parse(strFromU8(files['model.gltf']));
    const inline=p=>{let s='';for(let i=0;i<files[p].length;i+=32768)s+=String.fromCharCode(...files[p].subarray(i,i+32768));return btoa(s);};
    for(const b of d.buffers)b.uri='data:application/octet-stream;base64,'+inline(b.uri);
    for(const im of d.images)im.uri='data:image/png;base64,'+inline(im.uri);
    const loaded=await new GLTFLoader().parseAsync(JSON.stringify(d),'');let textures=0,skins=0;loaded.scene.traverse(o=>{if(o.isSkinnedMesh)skins++;if(o.isMesh&&o.material.map?.image?.width)textures++;});return {textures,skins};
  },result.base64);
  expect(checked.textures).toBeGreaterThan(0);expect(checked.skins).toBeGreaterThan(0);
});
