import {test,expect} from '@playwright/test';
import validator from 'gltf-validator';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';

test('Frostward surface baking keeps the UI responsive across reloads',async({page})=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?project=courier');await page.waitForFunction(()=>window.codexDesign?.ready);
  for(let pass=0;pass<2;pass++){
    const result=await page.evaluate(async()=>{
      let ticks=0,maxGap=0,last=performance.now();
      const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;},50);
      const start=performance.now();
      try{await window.codexDesign.load('frostward-sword');return {ticks,maxGap,ms:performance.now()-start,stats:window.codexDesign.stats()};}
      finally{clearInterval(timer);}
    });
    console.log('Frostward load',pass+1,JSON.stringify(result));
    expect(result.ticks).toBeGreaterThan(10);
    expect(result.maxGap).toBeLessThan(2000);
    expect(result.stats.triangles).toBe(930);
    expect(result.stats.meshes).toBe(32);
    expect(result.stats.warnings).toEqual([]);
  }
  expect(errors).toEqual([]);
});

for(const id of ['courier','kelp','vessel'])test(`${id}: animated GLB survives export, validation and reimport`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?project='+id);await page.waitForFunction(()=>window.codexDesign?.ready);
  const stats=await page.evaluate(()=>window.codexDesign.stats());
  const expected=await page.evaluate(()=>{const app=window.codexDesign;app.setTime(0.6);app.root.updateMatrixWorld(true);const samples=[];app.root.traverse(o=>{if(!o.isMesh)return;o.skeleton?.update();const v=o.position.clone();for(const i of [0,Math.floor(o.geometry.attributes.position.count/2)]){o.getVertexPosition(i,v).applyMatrix4(o.matrixWorld);samples.push({name:o.name,index:i,position:v.toArray()});}});return samples;});
  const encoded=await page.evaluate(()=>window.codexDesign.exportBase64('glb'));const bytes=Buffer.from(encoded.base64,'base64');
  const report=await validator.validateBytes(new Uint8Array(bytes),{uri:id+'.glb'});
  await mkdir('exports',{recursive:true});await writeFile(`exports/${id}.glb`,bytes);await writeFile(`exports/${id}.validation.json`,JSON.stringify(report,null,2));
  expect(report.issues.numErrors,JSON.stringify(report.issues.messages)).toBe(0);
  const loaded=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  expect(loaded.animations.length).toBe(stats.animations.length);
  let bones=0,skins=0;loaded.scene.traverse(o=>{if(o.isBone)bones++;if(o.isSkinnedMesh)skins++;});expect(bones).toBe(stats.bones);expect(skins).toBe(stats.skinnedMeshes);
  const mixer=new THREE.AnimationMixer(loaded.scene);mixer.clipAction(loaded.animations[0]).play();mixer.setTime(0.6);loaded.scene.updateMatrixWorld(true);
  for(const sample of expected){
    const target=loaded.scene.getObjectByName(sample.name),expectedPosition=new THREE.Vector3(...sample.position);
    if(target.isMesh){target.skeleton?.update();const p=target.getVertexPosition(sample.index,new THREE.Vector3()).applyMatrix4(target.matrixWorld);expect(p.distanceTo(expectedPosition)).toBeLessThan(0.0001);}
    else {
      // glTF splits multi-material meshes into a Group of primitives; indices are not stable across that split.
      let closest=Infinity;target.traverse(mesh=>{if(!mesh.isMesh)return;mesh.skeleton?.update();for(let i=0;i<mesh.geometry.attributes.position.count;i++){const p=mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);closest=Math.min(closest,p.distanceTo(expectedPosition));}});expect(closest).toBeLessThan(0.0001);
    }
  }
  expect(loaded.animations.every(c=>c.validate())).toBe(true);
  expect(errors).toEqual([]);
  await page.evaluate(()=>window.codexDesign.setTime(0));await page.screenshot({path:`exports/${id}-workshop.png`});
});
test('viewer controls, parameter changes, imports and download work',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>window.codexDesign?.ready);
  await page.getByRole('button',{name:'Skeleton',exact:false}).click();await expect(page.locator('#bones')).toHaveAttribute('aria-pressed','true');
  await page.getByLabel('Animation clip').selectOption('Walk');await page.getByLabel('Animation timeline').fill('0.5');await expect(page.locator('#time')).toHaveText('0.50 / 1.20 s');
  const old=await page.evaluate(()=>window.codexDesign.stats().size[1]);
  await page.locator('#parameter-height').fill('1.3');await page.locator('#parameter-height').dispatchEvent('change');
  await expect.poll(async()=>page.evaluate(()=>window.codexDesign.stats().size[1])).toBeGreaterThan(old);
  const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('courier.glb');
  await page.locator('#files').setInputFiles('exports/kelp.glb');await expect(page.locator('#asset-name')).toHaveText('kelp.glb');
  expect(await page.evaluate(()=>window.codexDesign.stats().bones)).toBe(9);
  await page.getByLabel('Export format').selectOption('obj');await expect(page.locator('#export-note')).toContainText('Static');
});
test('glTF is embedded and STL/OBJ geometry can be exported',async({page})=>{
  await page.goto('/?project=kelp');await page.waitForFunction(()=>window.codexDesign?.ready);
  for(const f of ['gltf','stl','obj','json']){const out=await page.evaluate(f=>window.codexDesign.exportBase64(f),f);const bytes=Buffer.from(out.base64,'base64');expect(bytes.length).toBeGreaterThan(100);await writeFile(`exports/kelp.${out.extension}`,bytes);if(f==='gltf'){const doc=JSON.parse(bytes.toString());expect(doc.animations).toHaveLength(2);expect(doc.buffers[0].uri).toMatch(/^data:/);const report=await validator.validateString(bytes.toString());expect(report.issues.numErrors).toBe(0);}}
});
test('narrow screen keeps viewport and export accessible',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.waitForFunction(()=>window.codexDesign?.ready);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);await expect(page.locator('#viewport')).toBeVisible();await expect(page.locator('#export-main')).toBeVisible();await page.screenshot({path:'exports/mobile.png',fullPage:true});
});
test('topology overlay, smart optimization and undo affect actual exported geometry',async({page})=>{
  await page.goto('/?project=courier');await page.waitForFunction(()=>window.codexDesign?.ready);
  await page.getByRole('button',{name:'Topology overlay'}).click();await expect(page.locator('#topology')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#topology-stats')).toContainText('Open / non-manifold edges');
  const before=await page.evaluate(()=>window.codexDesign.stats());await page.locator('#lod').fill('50');await page.locator('#lod').dispatchEvent('input');await expect(page.locator('#undo-optimize')).toBeEnabled();await expect(page.locator('#lod-level')).toHaveText('LOD1');
  const after=await page.evaluate(()=>window.codexDesign.stats());expect(after.triangles).toBeLessThan(before.triangles);expect(after.bones).toBe(before.bones);expect(after.skinnedMeshes).toBe(before.skinnedMeshes);
  const encoded=await page.evaluate(()=>window.codexDesign.exportBase64('glb'));const bytes=Buffer.from(encoded.base64,'base64');const report=await validator.validateBytes(new Uint8Array(bytes));expect(report.issues.numErrors).toBe(0);
  await writeFile('exports/courier-optimized.glb',bytes);await page.screenshot({path:'exports/topology-workshop.png'});
  await page.locator('#undo-optimize').click();expect(await page.evaluate(()=>window.codexDesign.stats().triangles)).toBe(before.triangles);
});
test('Roblox highlights and edge outlines render live, export as glTF extensions + geometry, and re-import',async({page})=>{
  test.setTimeout(150000); // several full GLB encodes under software WebGL
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?project=stud-shrine');await page.waitForFunction(()=>window.codexDesign?.ready);
  // ready means installed; the compositor writes its targets on the following frame.
  const live=await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const d=window.codexDesign,r=d.renderer,fx=d.highlightRenderer,rt=fx.highlightRT,buf=new Uint8Array(rt.width*rt.height*4);r.readRenderTargetPixels(rt,0,0,rt.width,rt.height,buf);let n=0;for(let i=3;i<buf.length;i+=4)if(buf[i]>0)n++;return {pixels:n,highlights:d.highlights().count,edges:d.stats().edgeOutlines};});
  expect(live.highlights).toBe(3);expect(live.edges).toBe(6);expect(live.pixels).toBeGreaterThan(2000);
  await page.evaluate(()=>window.codexDesign.setHighlight('Pickup',{fillTransparency:1,outlineColor:'#ff0000'}));
  const encoded=await page.evaluate(()=>window.codexDesign.exportBase64('glb'));const bytes=Buffer.from(encoded.base64,'base64');
  const report=await validator.validateBytes(new Uint8Array(bytes));expect(report.issues.numErrors,JSON.stringify(report.issues.messages.slice(0,5))).toBe(0);
  await writeFile('exports/stud-shrine.glb',bytes);
  const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  expect(json.extensionsUsed).toEqual(expect.arrayContaining(['CODEX_highlight','CODEX_edges','KHR_materials_unlit']));
  const pickup=json.nodes.find(n=>n.name==='Pickup');expect(pickup.extensions.CODEX_highlight.outlineColor).toBe('#ff0000');
  const names=json.nodes.map(n=>n.name);expect(names).toContain('Coin_HighlightOutline');expect(names).not.toContain('Coin_HighlightFill');expect(names).toContain('Pedestal_EdgeLines');
  await page.goto('/?import=exports/stud-shrine.glb');await page.waitForFunction(()=>window.codexDesign?.ready&&document.getElementById('asset-type').textContent==='IMPORTED ASSET');
  const restored=await page.evaluate(()=>{const d=window.codexDesign;let hidden=0;d.root.traverse(o=>{if(o.userData.codexHighlightShell&&!o.visible)hidden++;});return {h:d.highlights().count,edges:d.stats().edgeOutlines,hidden,color:d.root.getObjectByName('Pickup').userData.codexHighlight.outlineColor};});
  expect(restored.h).toBe(3);expect(restored.edges).toBe(6);expect(restored.hidden).toBeGreaterThan(5);expect(restored.color).toBe('#ff0000');
  await page.goto('/?import=exports/stud-shrine.glb&baked=1');await page.waitForFunction(()=>window.codexDesign?.ready&&document.getElementById('asset-type').textContent==='IMPORTED ASSET');
  expect(await page.evaluate(()=>{let v=0;window.codexDesign.root.traverse(o=>{if(/_(Highlight|Edge)/.test(o.name)&&o.visible)v++;});return v;})).toBeGreaterThan(5);
  await page.screenshot({path:'exports/stud-shrine-baked.png'});
  const luau=await page.evaluate(async()=>{await window.codexDesign.load('stud-shrine');const r=await window.codexDesign.export('lua');return new TextDecoder().decode(r.data);});
  expect(luau).toContain('CodexOutline.Setup');expect(luau).toContain('Pedestal_EdgeLines');
  expect(errors).toEqual([]);
});
test('LOD slider keeps skinned deformation, quality card scores topology, smart fix and LOD chain export work',async({page})=>{
  test.setTimeout(150000); // several full GLB encodes under software WebGL
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?project=kelp');await page.waitForFunction(()=>window.codexDesign?.ready);
  await expect(page.locator('#q-score')).not.toHaveText('–');
  const q=await page.evaluate(()=>window.codexDesign.quality());expect(q.score).toBeGreaterThan(80);expect(q.criteria.joints).toBe(1);
  const r=await page.evaluate(()=>window.codexDesign.lod(0.5));expect(r.after).toBeLessThan(r.before*0.7);expect(r.maxError).toBeLessThan(0.016);
  // Skinned mesh still deforms with normalized weights.
  const moved=await page.evaluate(()=>{const d=window.codexDesign,m=d.root.getObjectByName('SoftBody'),w=m.geometry.attributes.skinWeight;for(let i=0;i<w.count;i++)if(Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1)>1e-4)return -1;
    const p=m.geometry.attributes.position;let tip=0;for(let i=1;i<p.count;i++)if(p.getY(i)>p.getY(tip))tip=i;d.playClip('Curl');d.setTime(0);m.skeleton.update();const a=m.getVertexPosition(tip,new d.root.position.constructor());d.setTime(2);d.root.updateMatrixWorld(true);m.skeleton.update();return a.distanceTo(m.getVertexPosition(tip,new d.root.position.constructor()));});
  expect(moved).toBeGreaterThan(0.2);
  const bytes=Buffer.from((await page.evaluate(()=>window.codexDesign.exportBase64('glb'))).base64,'base64');const report=await validator.validateBytes(new Uint8Array(bytes));expect(report.issues.numErrors).toBe(0);
  await page.locator('#undo-optimize').click();
  const fixed=await page.evaluate(()=>window.codexDesign.fixTopology());expect(fixed.after.score).toBeGreaterThanOrEqual(fixed.before.score-1);
  await page.getByRole('button',{name:'Quads'}).click();await expect(page.locator('#quads')).toHaveAttribute('aria-pressed','true');
  const downloadPromise=page.waitForEvent('download');await page.locator('#lod-chain').click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('kelp_LODs.zip');
  await page.screenshot({path:'exports/lod-workshop.png'});
  expect(errors).toEqual([]);
});

test('sidebar hides models into the Asset Library and restores them; GFX renders presets with a watermark',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let workspace={hidden:[]};await page.route('**/api/workspace',async route=>{if(route.request().method()==='PUT')workspace=JSON.parse(route.request().postData());await route.fulfill({json:workspace});});
  await page.goto('/?project=stud-pine');await page.waitForFunction(()=>window.codexDesign?.ready);
  const row=page.locator('.project-row',{has:page.locator('[data-id="kelp"]')});await row.hover();await row.locator('.hide-model').click();
  await expect(row).toBeHidden();expect(workspace.hidden).toContain('kelp');
  await page.locator('#tab-library').click();const card=page.locator('.model-card.is-hidden');await expect(card).toHaveCount(1);
  await card.getByRole('button',{name:/Restore/}).click();await expect(page.locator('.model-card.is-hidden')).toHaveCount(0);expect(workspace.hidden).not.toContain('kelp');
  const plain=await page.evaluate(()=>window.codexDesign.gfx({preset:'icon',width:256,height:256,watermark:null}));
  const marked=await page.evaluate(()=>window.codexDesign.gfx({preset:'icon',width:256,height:256,watermark:{text:'WATERMARK',position:'center',opacity:1,size:0.12,color:'#ff00ff',stroke:null}}));
  expect(plain.width).toBe(256);expect(marked.base64).not.toBe(plain.base64);
  for(const preset of await page.evaluate(()=>window.codexDesign.gfxPresets))expect((await page.evaluate(p=>window.codexDesign.gfx({preset:p,width:320,height:240,watermark:null}),preset)).width).toBe(320);
  expect(errors).toEqual([]);
});
