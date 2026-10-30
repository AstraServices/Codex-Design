// PBR texture sets from YOUR material definition: npm run texture -- <textures/recipe.js | example name | all | --list>
//   [--size 256…4096] [--seed 1] [--color #7a5230 --tint 0.6] [--name out]
// A recipe file exports default {height(u,v,seed), albedo(ctx), roughness(ctx), metalness?(ctx), emissive?(ctx), normal?, metal?}
// built with src/texlab.js. Writes exports/textures/<name>_<size>/{albedo,normal,roughness,metalness,ao,height,orm[,emissive]}.png + material.json.
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generatePBR, packORM, PBR_EXAMPLES, PBR_EXAMPLE_NAMES } from '../src/pbr.js';
import { encodePNG } from '../src/png.js';
const args=process.argv.slice(2),take=(n,p=v=>v)=>{const i=args.indexOf('--'+n);if(i===-1)return undefined;const v=p(args[i+1]);args.splice(i,2);return v;};
if(args.includes('--list')){console.log('Examples (learn from them; write your own in textures/*.js):');for(const n of PBR_EXAMPLE_NAMES)console.log(`  ${n.padEnd(15)} ${PBR_EXAMPLES[n].note}`);process.exit(0);}
const size=take('size',Number)??2048,seed=take('seed',Number)??1,color=take('color'),tint=take('tint',Number),outName=take('name');
if(![256,512,1024,2048,4096].includes(size))throw new Error('--size must be 256, 512, 1024, 2048 or 4096');
const root=fileURLToPath(new URL('..',import.meta.url)),jobs=[];
for(const a of (args[0]==='all'?PBR_EXAMPLE_NAMES:[args[0]])){
  if(!a)throw new Error('Usage: npm run texture -- <textures/my-material.js|example|all|--list> [--size 4096]');
  const file=[a,path.join(root,a),path.join(root,'textures',a),path.join(root,'textures',a+'.js')].find(f=>/\.m?js$/.test(f)&&existsSync(f));
  if(file){const def=(await import(pathToFileURL(path.resolve(file)).href)).default;jobs.push([outName??def.name??path.basename(file).replace(/\.m?js$/,''),def]);}
  else if(PBR_EXAMPLES[a])jobs.push([outName??a,a]);else throw new Error(`No recipe file or example named ${a}`);
}
for(const [name,def] of jobs){
  const t=Date.now(),dir=path.join(root,'exports','textures',`${name}_${size}`)+path.sep;await mkdir(dir,{recursive:true});
  const set=generatePBR(def,{size,seed,color,tint,onProgress:p=>process.stderr.write(`\r${name} ${Math.round(p*100)}%   `)});
  const maps={albedo:set.albedo,normal:set.normal,roughness:set.roughness,metalness:set.metalness,ao:set.ao,height:set.height,orm:packORM(set),...(set.emissive?{emissive:set.emissive}:{})};
  for(const [k,data] of Object.entries(maps))await writeFile(dir+k+'.png',encodePNG(data,size,size,b=>deflateSync(b,{level:6}),{flipY:true}));
  await writeFile(dir+'material.json',JSON.stringify({name,note:set.note,size,seed,color,metal:set.metal,gltf:{baseColorTexture:'albedo.png',normalTexture:'normal.png (OpenGL +Y)',metallicRoughnessTexture:'orm.png (G=roughness, B=metalness)',occlusionTexture:'orm.png (R)',...(set.emissive?{emissiveTexture:'emissive.png'}:{})},roblox:{SurfaceAppearance:{ColorMap:'albedo.png',NormalMap:'normal.png',RoughnessMap:'roughness.png',MetalnessMap:'metalness.png'},note:'Roblox imports up to 1024²: downsize 2K/4K maps for Roblox.'}},null,2));
  process.stderr.write('\r');console.log(JSON.stringify({material:name,dir,size,seconds:+((Date.now()-t)/1000).toFixed(1)}));
}
