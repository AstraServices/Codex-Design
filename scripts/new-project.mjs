import { writeFile,access } from 'node:fs/promises';
const id=process.argv[2];
if(!id||!/^[a-z][a-z0-9-]{0,63}$/.test(id))throw new Error('Usage: npm run new -- my-model');
const json=new URL(`../projects/${id}.json`,import.meta.url),js=new URL(`../projects/${id}.js`,import.meta.url);
for(const f of [json,js]){try{await access(f);}catch(e){if(e.code==='ENOENT')continue;throw e;}throw new Error('Project already exists; choose another id');}
await writeFile(js,`export function build(k) {
  const {mesh,material,group,sample,clip,parameters:p}=k;
  const pivot=group('Pivot',{at:[0,0.6,0]});
  mesh('Body','roundedBox',[1,1,1,3,0.12],material(p.color),{parent:pivot});
  clip('Float',3,[sample(pivot,'position',3,24,t=>[0,0.6+Math.sin(t*Math.PI*2/3)*0.12,0])]);
}
`,{flag:'wx'});
await writeFile(json,JSON.stringify({name:id,description:'Procedural model · edit the JS recipe',module:id+'.js',parameters:{color:'#b7d495'},controls:{color:{label:'Surface color',type:'color'}}},null,2)+'\n',{flag:'wx'});
console.log(`Created projects/${id}.js and .json. Edit build(k) to create your model.`);
