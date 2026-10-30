import { unzipSync } from 'fflate';
import { launchBrowser } from './browser.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const args=process.argv.slice(2);
const take=(name,parse)=>{const i=args.indexOf(name);if(i===-1)return undefined;const v=parse(args[i+1]);args.splice(i,2);return v;};
const flag=name=>{const i=args.indexOf(name);if(i===-1)return false;args.splice(i,1);return true;};
const highlights=take('--highlights',v=>{if(!['full','outline','none'].includes(v))throw new Error('--highlights requires full | outline | none');return v;})??'full';
const ratio=take('--ratio',v=>{const n=Number(v);if(!Number.isFinite(n)||n<0.1||n>1)throw new Error('--ratio requires a number from 0.1 to 1');return n;});
// Smart LOD (QEM, skin/UV/crease aware): --lod 0.5 removes ~50% of triangles; --lod-chain writes LOD0–LOD3.
const lod=take('--lod',v=>{const n=Number(v);if(!Number.isFinite(n)||n<0||n>0.95)throw new Error('--lod requires a reduction from 0 to 0.95');return n;});
const maxError=take('--max-error',v=>{const n=Number(v);if(!Number.isFinite(n)||n<=0||n>0.2)throw new Error('--max-error requires 0–0.2 (fraction of model size)');return n;});
// Viewer lighting preset for PNG renders: studio | dramatic | soft | sunset | roblox | classic.
const light=take('--light',v=>{if(!/^[a-z]+$/.test(v||''))throw new Error('--light requires a preset name');return v;});
const cull=flag('--cull'),chain=flag('--lod-chain'),fix=flag('--fix-topology');
// Smart topology before export: --topology auto|animation|subdivision|game|print (context-aware; --fix-topology = auto).
const topoIntent=take('--topology',v=>{if(!['auto','animation','subdivision','game','print'].includes(v))throw new Error('--topology requires auto|animation|subdivision|game|print');return v;});
const target=take('--target',v=>{if(!['roblox','generic'].includes(v))throw new Error('--target requires roblox | generic');return v;})??'roblox';
const [id='courier',format='glb',destination]=args;
async function extractRoblox(filename,bytes){const dir=filename.replace(/\.zip$/i,'');await mkdir(dir,{recursive:true});for(const [name,data] of Object.entries(unzipSync(bytes))){const file=path.resolve(dir,name);if(!file.startsWith(path.resolve(dir)+path.sep))throw new Error('Package path escaped output directory');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data);}return dir;}
if(!/^[a-z][a-z0-9-]{0,63}$/.test(id)||!['glb','gltf','obj','stl','json','png','lua','roblox'].includes(format))throw new Error('Usage: npm run export -- project [glb|gltf|roblox|obj|stl|json|png|lua] [--target roblox|generic] [output path] [--highlights full|outline|none] [--lod 0.5 --max-error 0.015 --cull] [--lod-chain] [--fix-topology] [--ratio 0.6] [--light studio|dramatic|soft|sunset|roblox|classic]');
const url=process.env.CODEX_DESIGN_URL||'http://127.0.0.1:4173';
try{const r=await fetch(url+'/api/health');if(!r.ok)throw new Error();}catch{throw new Error('Start the workshop first: npm start (or npm run preview -- <slug>)');}
const {browser}=await launchBrowser();
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${url}/?project=${id}${light?`&light=${light}`:''}`);await page.waitForFunction(()=>window.codexDesign?.ready,{timeout:30000});
  if(await page.locator('.project.active').getAttribute('data-id')!==id)throw new Error(`Project not found: ${id}`);
  const outDir=fileURLToPath(new URL('../exports/',import.meta.url));await mkdir(outDir,{recursive:true});
  const encode=f=>page.evaluate(f=>window.codexDesign.exportBase64(f.format,{bakeHighlights:f.highlights==='none'?false:f.highlights,target:f.target}),{format:f,highlights,target});
  const fixed=fix||topoIntent?await page.evaluate(i=>window.codexDesign.smartTopology(i),topoIntent||'auto'):undefined;
  if(chain){
    if(!['glb','gltf'].includes(format))throw new Error('--lod-chain exports glb or gltf');
    const levels=[['LOD0',0,0.015,false],['LOD1',0.5,0.01,false],['LOD2',0.75,0.025,true],['LOD3',0.88,0.05,true]],files=[];
    for(const [name,reduction,err,c] of levels){
      const r=await page.evaluate(o=>window.codexDesign.lod(o.reduction,{maxError:o.err,cullDetails:o.c}),{reduction,err,c});
      const out=await encode(format),file=path.join(outDir,`${id}_${name}.${out.extension}`);await writeFile(file,Buffer.from(out.base64,'base64'));
      files.push({level:name,file,triangles:r?r.after:(await page.evaluate(()=>window.codexDesign.stats())).triangles,maxError:r?+r.maxError.toFixed(4):0});
    }
    console.log(JSON.stringify({lods:files,...(fixed?{fixTopology:fixed}:{}),errors},null,2));if(errors.length)process.exitCode=1;
  }else{
    const optimization=ratio===undefined?undefined:await page.evaluate(r=>window.codexDesign.optimize(r),ratio);
    const reduced=lod===undefined?undefined:await page.evaluate(o=>window.codexDesign.lod(o.lod,{maxError:o.maxError,cullDetails:o.cull}),{lod,maxError,cull});
    let filename;
    if(format==='png'){filename=destination||path.join(outDir,id+(light?`_${light}`:'')+'.png');await page.evaluate(()=>window.codexDesign.setTime(0));await page.locator('#viewport').screenshot({path:filename,timeout:120000});}
    else{const result=await encode(format);filename=destination||path.join(outDir,`${id}${lod!==undefined?`_lod${Math.round(lod*100)}`:''}.${result.extension}`);const bytes=Buffer.from(result.base64,'base64');await writeFile(filename,bytes);if(format==='roblox')await extractRoblox(filename,bytes);}
    const stats=await page.evaluate(()=>window.codexDesign.stats());
    console.log(JSON.stringify({file:filename,...stats,...(optimization?{optimization:{before:optimization.before,after:optimization.after}}:{}),...(reduced?{lod:{before:reduced.before,after:reduced.after,achieved:+reduced.achieved.toFixed(3),maxError:+reduced.maxError.toFixed(4)}}:{}),...(fixed?{fixTopology:fixed}:{}),errors},null,2));if(errors.length)process.exitCode=1;
  }
}finally{await browser.close();}
