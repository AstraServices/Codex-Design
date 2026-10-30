import {launchBrowser} from './browser.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import validator from 'gltf-validator';
const id=process.argv[2];
if(!/^[a-z][a-z0-9-]{0,63}$/.test(id||''))throw new Error('Usage: node scripts/verify-roblox.mjs <slug>');
const bytes=await readFile(new URL(`../exports/${id}.glb`,import.meta.url));
const validation=await validator.validateBytes(new Uint8Array(bytes));
if(validation.issues.numErrors)throw new Error(JSON.stringify(validation.issues));
const {browser}=await launchBrowser();
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(`http://127.0.0.1:4173/?project=${id}`);await page.waitForFunction(()=>window.codexDesign?.ready,{timeout:120000});
  const result=await page.evaluate(async id=>{
    const T=await import('/node_modules/three/build/three.module.js'),{GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const loaded=await new GLTFLoader().loadAsync(`/exports/${id}.glb`),mixer=new T.AnimationMixer(loaded.scene),d=window.codexDesign;
    let maxError=0,comparisons=0,texturedMeshes=0;
    loaded.scene.traverse(o=>{if(o.isMesh){const mats=Array.isArray(o.material)?o.material:[o.material];if(mats.some(m=>m.map?.image?.width))texturedMeshes++;}});
    for(const clip of loaded.animations){
      mixer.stopAllAction();mixer.clipAction(clip).play();d.playClip(clip.name);
      for(const t of [0,clip.duration*.37,clip.duration*.83]){
        d.setTime(t);mixer.setTime(t);d.root.updateMatrixWorld(true);loaded.scene.updateMatrixWorld(true);
        d.root.traverse(source=>{
          if(!source.isMesh)return;source.skeleton?.update();
          const target=loaded.scene.getObjectByName(source.name+'_Geometry')||loaded.scene.getObjectByName(source.name);
          if(!target)throw new Error('Exported mesh missing: '+source.name);
          const candidates=[];target.traverse(o=>{if(!o.isMesh||/_(Highlight|Edge)/.test(o.name))return;o.skeleton?.update();const p=new T.Vector3();for(let i=0;i<o.geometry.attributes.position.count;i++)candidates.push(o.getVertexPosition(i,p).applyMatrix4(o.matrixWorld).clone());});
          for(const i of [0,Math.floor(source.geometry.attributes.position.count/2),source.geometry.attributes.position.count-1]){
            const expected=source.getVertexPosition(i,new T.Vector3()).applyMatrix4(source.matrixWorld);let distance=Infinity;for(const v of candidates)distance=Math.min(distance,v.distanceToSquared(expected));
            maxError=Math.max(maxError,Math.sqrt(distance));comparisons++;
          }
        });
      }
    }
    d.playClip(loaded.animations[0]?.name);d.setTime(0);return {clips:loaded.animations.length,comparisons,maxError,texturedMeshes};
  },id);
  await page.screenshot({path:`exports/${id}.source-preview.png`});
  await page.goto(`http://127.0.0.1:4173/?import=exports/${id}.glb&baked=1`);
  await page.waitForFunction(()=>window.codexDesign?.ready,{timeout:120000});
  await page.screenshot({path:`exports/${id}.roblox-preview.png`});
  const report={validationErrors:validation.issues.numErrors,...result};await writeFile(`exports/${id}.roblox-verification.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(result.maxError>1e-4)throw new Error('Deformation round trip exceeded tolerance');
}finally{await browser.close();}
