import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { zipSync, strToU8 } from 'fflate';
import { createKit, inspectAsset, disposeAsset } from './kit.js';
import { encodeAsset, download } from './exporters.js';
import { auditTopology, optimizeTopology, createTopologyOverlay } from './topology.js';
import { HighlightRenderer, restoreImportedHighlights, MAX_HIGHLIGHTS } from './highlight.js';
import { restoreImportedEdges } from './edges.js';
import { createPanels } from './app-panels.js';
import { createLodPanel } from './app-lod.js';
import { geometryPool } from './worker-pool.js';
import { LightingRig, LIGHTING_PRESETS, DEFAULT_LIGHTING } from './lighting.js';
import { createGfxPanel } from './app-gfx.js';
import { createSurfacePanel } from './app-surface.js';

const $=id=>document.getElementById(id);
let asset=null, mixer=null, action=null, helper=null, playing=true, busy=false, revision=0, project=null, projects=[], materialsWire=false;
let lastTime=performance.now(), loadTicket=0;
let topologyVisible=false,topologyOverlay=null,topologyReport=null,optimizationUndo=null;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(35,1,0.01,1000);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
$('viewport').append(renderer.domElement);
// Every frame goes through the highlight compositor: scene → Roblox-style highlights → tone mapping.
const fx=new HighlightRenderer(renderer);let highlightEntries=[],panels=null,lodPanel=null;
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*0.54;controls.minDistance=0.2;
// Key/fill/rim rig that follows the orbit, contact shadow, fitted shadow frustum and SSAO (src/lighting.js).
const lighting=new LightingRig(renderer,scene,fx);
const grid=new THREE.GridHelper(200,200,'#506047','#3c4a37');grid.position.y=-0.098;grid.material.transparent=true;grid.material.opacity=0.22;scene.add(grid);
new ResizeObserver(()=>{const {width,height}=$('viewport').getBoundingClientRect();camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);fx.setSize(width,height);}).observe($('viewport'));
function message(text){$('status').textContent=text;}
let errorTimer;
function error(e){console.error(e);$('error').textContent=e.message||String(e);$('error').hidden=false;clearTimeout(errorTimer);errorTimer=setTimeout(()=>$('error').hidden=true,12000);message('Action needs attention');}
function guarded(fn){return (...args)=>Promise.resolve().then(()=>fn(...args)).catch(error);}
function frame(){
  if(!asset)return;
  const box=new THREE.Box3().setFromObject(asset.root),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const radius=Math.max(size.x,size.y,size.z,0.2),distance=radius*1.65/Math.min(1,camera.aspect);
  controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(0.8,0.38,1.4).normalize().multiplyScalar(distance));
  camera.near=Math.max(0.001,radius/1000);camera.far=Math.max(100,radius*100);camera.updateProjectionMatrix();
  lighting.fit(box);grid.position.y=box.min.y-0.01;controls.update();
}
function stats(){
  const s=inspectAsset(asset.root,asset.clips);
  $('stats').textContent=`${s.triangles.toLocaleString()} TRIANGLES · ${s.meshes} MESHES · ${s.bones} JOINTS`;
  $('structure').replaceChildren();
  for(const [label,value] of [['Highlights',`${s.highlights} / ${MAX_HIGHLIGHTS}`],['Edge outlines',s.edgeOutlines],['Textures',s.textures],['Meshes',s.meshes],['Triangles',s.triangles.toLocaleString()],['Materials',s.materials],['Bones / skinned meshes',`${s.bones} / ${s.skinnedMeshes}`],['Animation clips',s.animations.length],['Dimensions (m)',s.size.join(' × ')]]){
    const row=document.createElement('div');row.className='structure-row';const l=document.createElement('span'),v=document.createElement('b');l.textContent=label;v.textContent=value;row.append(l,v);$('structure').append(row);
  }
  if(s.warnings.length)message(s.warnings.join(' · '));
  return s;
}
// Animation choreography for GFX videos: plan = {clips: 'all' | name | [names], mode: 'single' | 'sequence' | 'together',
// speed, crossfade (s), loops, weights (together), seamless (loop end → start with the same crossfade), duration (s)}.
// Segments overlap by the crossfade and weights ramp linearly, so poses never jump; with seamless the last clip blends
// into the first and the video loops without a seam. apply(t) poses the model at time t.
function choreography(plan={}){
  const clips=asset?.clips??[],names=!plan.clips||plan.clips==='all'?clips.map(c=>c.name):[plan.clips].flat();
  const list=names.map(n=>{const c=clips.find(c=>c.name===n);if(!c)throw new Error(`No animation clip "${n}" (have: ${clips.map(c=>c.name).join(', ')||'none'})`);return c;});
  const before={clip:$('clip').value,playing};setPlaying(false);
  const restore=()=>{mixer.stopAllAction();chooseClip(before.clip);if(before.playing)setPlaying(true);};
  if(!list.length)return {duration:plan.duration??3,apply(){},restore};
  const speed=plan.speed??1,xf0=Math.max(0,plan.crossfade??0.25),loops=Math.max(1,Math.round(plan.loops??1)),weights=plan.weights??[],seamless=plan.seamless!==false;
  const mode=plan.mode??(list.length>1?'sequence':'single');
  const pose=(c,time,w)=>{const a=mixer.clipAction(c);a.enabled=true;a.setLoop(THREE.LoopRepeat,Infinity);a.play();a.time=((time%c.duration)+c.duration)%c.duration;a.setEffectiveWeight(w);};
  if(mode==='together'){
    const duration=plan.duration??Math.max(...list.map(c=>c.duration))/speed*loops;
    return {duration,mode,clips:list.map(c=>c.name),restore,apply(t){mixer.stopAllAction();list.forEach((c,i)=>pose(c,t*speed,weights[i]??1));mixer.update(0);asset.root.updateMatrixWorld(true);}};
  }
  // Sequence: segment i starts where the previous one begins to fade out. Same clip back-to-back continues without a fade.
  const order=[];for(let l=0;l<loops;l++)order.push(...list);
  const segs=order.map(c=>({c,d:c.duration/speed}));
  const xfAfter=i=>{const n=segs[i+1]??(seamless?segs[0]:null);return !n||n.c===segs[i].c||segs.length===1?0:Math.min(xf0,segs[i].d/2,n.d/2);};
  let s=0;segs.forEach((g,i)=>{g.start=s;g.out=xfAfter(i);g.in=i>0?segs[i-1].out:0;s+=g.d-g.out;});
  if(seamless&&segs.length>1)segs[0].in=segs.at(-1).out;
  const total=seamless?s:segs.at(-1).start+segs.at(-1).d,duration=plan.duration??total;
  return {duration,mode:'sequence',clips:order.map(c=>c.name),restore,apply(t){
    mixer.stopAllAction();const T=seamless?((t%total)+total)%total:Math.min(t,total-1e-6);const active=[];
    segs.forEach((g,i)=>{for(const shift of seamless?[0,total,-total]:[0]){const local=T-g.start+shift;if(local<0||local>=g.d)continue;
      const wi=g.in>0?Math.min(1,local/g.in):1,wo=g.out>0?Math.min(1,(g.d-local)/g.out):1;active.push([g.c,local*speed,Math.min(wi,wo)]);}});
    const sum=active.reduce((a,[, ,w])=>a+w,0)||1;for(const [c,time,w] of active)pose(c,time,w/sum);
    mixer.update(0);asset.root.updateMatrixWorld(true);
  }};
}
function chooseClip(name){
  if(!asset)return;
  mixer.stopAllAction();
  const clip=asset.clips.find(c=>c.name===name);
  action=clip?mixer.clipAction(clip).reset().play():null;
  mixer.setTime(0);$('scrub').max=String(clip?.duration||1);$('scrub').value='0';
  $('clip').value=name||'';$('play').disabled=!clip;$('scrub').disabled=!clip;$('clip-tag').textContent=clip?`${clip.tracks.length} TRACKS`:'STATIC ASSET';
  updateTime();
}
function updateTime(){const t=action?.time||0,d=action?.getClip().duration||0;$('scrub').value=String(t);$('time').value=`${t.toFixed(2)} / ${d.toFixed(2)} s`;}
function setPlaying(value){playing=value;$('play').textContent=playing?'Ⅱ':'▶';$('play').setAttribute('aria-label',playing?'Pause animation':'Play animation');}
function install(next,keepView=false){
  const oldClip=$('clip').value;
  optimizationUndo?.commit();optimizationUndo=null;
  if(topologyOverlay){scene.remove(topologyOverlay);topologyOverlay.userData.dispose();topologyOverlay=null;}
  mixer?.stopAllAction();
  if(helper){scene.remove(helper);helper.dispose();helper=null;}
  if(asset){scene.remove(asset.root);disposeAsset(asset.root);mixer?.uncacheRoot(asset.root);}
  asset=next;scene.add(asset.root);mixer=new THREE.AnimationMixer(asset.root);
  highlightEntries=panels?panels.reset():[];lodPanel?.installed();
  helper=new THREE.SkeletonHelper(asset.root);helper.visible=$('bones').getAttribute('aria-pressed')==='true';helper.material.depthTest=false;scene.add(helper);
  asset.root.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;for(const m of (Array.isArray(o.material)?o.material:[o.material]))m.wireframe=materialsWire||topologyVisible;}});
  $('clip').replaceChildren();
  for(const c of asset.clips){const option=document.createElement('option');option.value=option.textContent=c.name;$('clip').append(option);}
  if(!asset.clips.length){const o=document.createElement('option');o.value='';o.textContent='Rest pose';$('clip').append(o);}
  chooseClip(asset.clips.find(c=>c.name===oldClip)?.name||asset.clips[0]?.name||'');
  if(!keepView)frame();stats();refreshTopology();message('Asset ready · live file sync active');
  window.codexDesign.ready=true;
}
async function loadProject(id,{keepView=false,parameters}={}){
  const ticket=++loadTicket;
  const meta=projects.find(p=>p.id===id);if(!meta)throw new Error(`Project not found: ${id}`);
  window.codexDesign.ready=false;
  const k=createKit(parameters||meta.parameters);
  try {
    if(!/^[a-z][a-z0-9-]*\.js$/.test(meta.module))throw new Error('Invalid project module');
    const module=await import(`/projects/${meta.module}?v=${Date.now()}-${revision++}`);
    await module.build(k);
    if(ticket!==loadTicket){disposeAsset(k.root);return;}
    project={...meta,parameters:{...k.parameters}};
    if(!keepView)setLighting(new URL(location).searchParams.get('light')||meta.lighting||DEFAULT_LIGHTING);
    install({root:k.root,clips:k.clips},keepView);
    $('asset-type').textContent='PROCEDURAL ASSET';$('asset-name').textContent=meta.name;$('asset-description').textContent=meta.description;
    document.querySelectorAll('.project').forEach(b=>b.classList.toggle('active',b.dataset.id===id));renderLibrary();
    $('save').disabled=false;$('recipe').disabled=false;
    renderParameters();
    const url=new URL(location);url.searchParams.set('project',id);history.replaceState({},'',url);
    if(!navigator.webdriver)setTimeout(()=>ensureThumbnail(id).catch(()=>{}),600);
  }catch(e){disposeAsset(k.root);window.codexDesign.ready=!!asset;throw e;}
}
function renderParameters(){
  $('parameters').replaceChildren();
  if(!project){$('parameters').textContent='Imported asset · use Codex to edit source.';return;}
  for(const [name,spec] of Object.entries(project.controls||{})){
    const div=document.createElement('div');div.className='control';const label=document.createElement('label');label.textContent=spec.label;
    const input=document.createElement('input');input.type=spec.type==='color'?'color':'range';input.id=`parameter-${name}`;input.setAttribute('aria-label',spec.label);input.value=String(project.parameters[name]);
    const output=document.createElement('output');output.textContent=input.value;
    if(input.type==='range'){input.min=spec.min;input.max=spec.max;input.step=spec.step||0.01;label.htmlFor=input.id;label.append(output);div.append(label,input);}
    else{label.htmlFor=input.id;label.append(input);div.append(label);}
    input.value=String(project.parameters[name]);output.textContent=input.value;
    input.oninput=()=>{output.textContent=input.value;};
    input.onchange=guarded(()=>loadProject(project.id,{keepView:true,parameters:{...project.parameters,[name]:input.type==='color'?input.value:Number(input.value)}}));
    $('parameters').append(div);
  }
}
let workspace={hidden:[]};
const kindOf=p=>p.id==='courier'?'CHARACTER / RIGGED':p.id==='kelp'?'ORGANIC / WEIGHTED':/stud|voxel|pine|sign/.test(p.id)?'STUD / BAKED':/topology|bracket/.test(p.id)?'ENGINEERING':/pbr|texture/.test(p.id)?'TEXTURES':'PROCEDURAL';
async function saveWorkspace(){const r=await fetch('/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(workspace)});if(!r.ok)throw new Error('Cannot save workspace');}
const setHidden=guarded(async(id,hide)=>{workspace.hidden=hide?[...new Set([...workspace.hidden,id])]:workspace.hidden.filter(h=>h!==id);await saveWorkspace();renderProjects();message(hide?`Hidden from the sidebar · restore it from the Asset Library`:`Restored to the sidebar`);});
function renderProjects(){
  const hidden=new Set(workspace.hidden);$('projects').replaceChildren();
  projects.forEach((p,i)=>{
    // Hidden models keep their (invisible) button so ?project=<id> and the CLI still find the active project.
    const row=document.createElement('div');row.className='project-row';row.hidden=hidden.has(p.id);
    const b=document.createElement('button');b.className='project';b.dataset.id=p.id;b.classList.toggle('active',p.id===project?.id);
    const icon=document.createElement('span');icon.className='project-icon';icon.textContent=['⬡','⌇','◉'][i%3];
    const text=document.createElement('span'),name=document.createElement('strong'),small=document.createElement('small');name.textContent=p.name.split(' / ')[0];small.textContent=kindOf(p);text.append(name,small);b.append(icon,text);b.onclick=guarded(()=>loadProject(p.id));
    const x=document.createElement('button');x.className='hide-model';x.title='Hide from sidebar (restore in Asset Library)';x.setAttribute('aria-label',`Hide ${name.textContent}`);x.textContent='×';x.onclick=e=>{e.stopPropagation();setHidden(p.id,true);};
    row.append(b,x);$('projects').append(row);
  });
  $('hidden-count').textContent=hidden.size?`${hidden.size} HIDDEN`:'';$('library-count').textContent=projects.length;
  renderLibrary();
}
function renderLibrary(){
  const q=$('model-search').value.trim().toLowerCase(),hidden=new Set(workspace.hidden);$('model-grid').replaceChildren();
  for(const p of projects.filter(p=>!q||(p.id+' '+p.name+' '+(p.description??'')).toLowerCase().includes(q))){
    const card=document.createElement('div');card.className='model-card';card.classList.toggle('is-hidden',hidden.has(p.id));card.classList.toggle('active',p.id===project?.id);
    const img=document.createElement('img');img.alt='';img.loading='lazy';img.src=`/exports/thumbs/${p.id}.png?v=${thumbVersion}`;img.onerror=()=>{const f=document.createElement('div');f.className='thumb-fallback';f.textContent='⬡';img.replaceWith(f);};
    const name=document.createElement('strong');name.textContent=p.name.split(' / ')[0];const small=document.createElement('small');small.textContent=hidden.has(p.id)?'HIDDEN · '+kindOf(p):kindOf(p);
    const actions=document.createElement('div');actions.className='card-actions';
    const open=document.createElement('button');open.textContent='Open';open.onclick=guarded(()=>loadProject(p.id));
    const toggle=document.createElement('button');toggle.textContent=hidden.has(p.id)?'↩ Restore':'Hide';toggle.onclick=()=>setHidden(p.id,!hidden.has(p.id));
    actions.append(open,toggle);card.append(img,name,small,actions);$('model-grid').append(card);
  }
}
let thumbVersion=Date.now();
// Thumbnail for the Asset Library: rendered once per project (transparent GFX), stored in exports/thumbs/.
async function ensureThumbnail(id){
  try{const r=await fetch(`/exports/thumbs/${id}.png`,{method:'HEAD'});if(r.ok)return;}catch{}
  const t=await window.codexDesign.gfx({preset:'transparent',width:256,height:256,watermark:null});
  await fetch(`/api/thumbs/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64:t.base64})});thumbVersion=Date.now();renderLibrary();
}
function selectTab(tab){for(const t of ['workspace','library']){$('tab-'+t).setAttribute('aria-selected',String(t===tab));$('pane-'+t).hidden=t!==tab;}}
$('tab-workspace').onclick=()=>selectTab('workspace');$('tab-library').onclick=()=>selectTab('library');$('model-search').oninput=renderLibrary;
async function refreshProjects(){
  const response=await fetch('/api/projects');if(!response.ok)throw new Error('Cannot read project library');projects=await response.json();
  try{const w=await (await fetch('/api/workspace')).json();workspace={hidden:Array.isArray(w.hidden)?w.hidden:[]};}catch{}
  renderProjects();
}
async function exportAsset(format=$('format').value,options={}){
  if(!asset)throw new Error('No asset loaded');if(busy)throw new Error('An export is already running');
  busy=true;message(`Encoding ${format.toUpperCase()}…`);
  const selected=action?.getClip().name,time=action?.time||0;
  try{
    // Export animated formats from rest transforms, keeping all clips; static formats bake the displayed pose.
    if(['glb','gltf','json','roblox'].includes(format))mixer.stopAllAction();
    const result=await encodeAsset(asset.root,asset.clips,format,{bakeHighlights:$('bake-highlights').value==='none'?false:$('bake-highlights').value,name:project?.id||'Asset',...options});
    message(`${format.toUpperCase()} ready · ${(result.data.byteLength/1024).toFixed(1)} KB`);
    return result;
  }finally{if(selected){chooseClip(selected);mixer.setTime(time);}busy=false;}
}
async function exportDownload(){const r=await exportAsset(undefined,{target:$('export-target').value});download(r.data,`${project?.id||'imported-model'}.${r.extension}`,r.mime);}
$('export').onclick=guarded(exportDownload);
// Header "Export model" asks for the format first (GLB pre-selected), then downloads.
$('export-main').onclick=()=>{const form=$('export-choices');form.querySelector('input[value="glb"]').checked=true;$('export-dialog').showModal();};
$('export-go').onclick=guarded(async()=>{const f=$('export-choices').querySelector('input[name=export-format]:checked')?.value||'glb';$('format').value=f;$('format').onchange?.();$('bake-highlights').value=$('export-highlights').value;$('export-dialog').close();await exportDownload();});
$('format').onchange=()=>{const f=$('format').value;$('export').textContent=`↓ Download .${f==='roblox'?'roblox.zip':f==='obj'?'obj.zip':f==='json'?'three.json':f}`;$('export-note').textContent=f==='roblox'?'Extract ZIP before importing model.gltf. Includes PNGs, material mapping, editable animation saves and a Studio installer.':f==='lua'?'Roblox Script that recreates every Highlight on the imported model (Adornee by part name, pulse → TweenService).':['obj','stl'].includes(f)?'Static current pose. Bones and animation are omitted. OBJ includes base-color MTL; STL includes geometry.':'Materials, textures, skeleton, clips and highlight settings (node extras). Ready for realtime engines.';$('bake-row').hidden=!['glb','gltf'].includes(f);};
$('save').onclick=guarded(async()=>{if(!project)return;const res=await fetch(`/api/projects/${project.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({parameters:project.parameters})});if(!res.ok)throw new Error((await res.json()).error);await refreshProjects();message('Parameters saved to project file');});
$('recipe').onclick=guarded(async()=>{if(!project)return;const source=await(await fetch('/projects/'+project.module)).text();const {id,...meta}=project;download(zipSync({[project.id+'.json']:strToU8(JSON.stringify(meta,null,2)),[project.module]:strToU8(source),'README.txt':strToU8('Copy the two files into CodexDesign/projects. Requires the Codex Design shared engine.')}),project.id+'.recipe.zip','application/zip');});
$('home').onclick=frame;
$('wire').onclick=()=>{materialsWire=!materialsWire;$('wire').setAttribute('aria-pressed',String(materialsWire));setWire();};
$('bones').onclick=()=>{if(helper){helper.visible=!helper.visible;$('bones').setAttribute('aria-pressed',String(helper.visible));}};
$('grid').onclick=()=>{grid.visible=!grid.visible;$('grid').setAttribute('aria-pressed',String(grid.visible));};
$('shot').onclick=()=>{lighting.update(camera);fx.render(scene,camera,panels?.entries??highlightEntries);renderer.domElement.toBlob(blob=>{if(blob)download(blob,(project?.id||'model')+'.png','image/png');});};
$('clip').onchange=()=>chooseClip($('clip').value);$('play').onclick=()=>setPlaying(!playing);$('reset').onclick=()=>{mixer?.setTime(0);updateTime();};
$('scrub').oninput=()=>{setPlaying(false);mixer?.setTime(Number($('scrub').value));updateTime();};
$('import').onclick=()=>$('files').click();$('files').onchange=guarded(()=>importFiles([...$('files').files]));
document.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();setPlaying(!playing);}if(e.key.toLowerCase()==='f')frame();if(e.key.toLowerCase()==='l'){const names=Object.keys(LIGHTING_PRESETS);setLighting(names[(names.indexOf(lighting.name)+1)%names.length]);}});
const lightSelect=document.createElement('select');lightSelect.id='lighting';lightSelect.title='Viewer lighting (L)';lightSelect.setAttribute('aria-label','Viewer lighting');
for(const [name,p] of Object.entries(LIGHTING_PRESETS)){const o=document.createElement('option');o.value=name;o.textContent='☀ '+p.label;lightSelect.append(o);}
lightSelect.onchange=guarded(()=>setLighting(lightSelect.value));document.querySelector('.view-tools').append(lightSelect);
function setLighting(spec){const s=lighting.apply(spec);lightSelect.value=s.preset;return s;}
async function importFiles(files,{baked=false}={}){
  if(!files.length)return;
  const file=files.find(f=>/\.(glb|gltf|fbx|obj|stl)$/i.test(f.name));if(!file)throw new Error('Choose GLB, glTF, FBX, OBJ or STL');
  const urls=new Map(files.map(f=>[f.name,URL.createObjectURL(f)]));
  const manager=new THREE.LoadingManager();
  manager.setURLModifier(url=>{if(url.startsWith('data:')||url.startsWith('blob:'))return url;const local=urls.get(decodeURIComponent(url.split('/').pop()));if(!local)throw new Error(`Missing dependency: ${url}. Select the model and its textures / BIN together.`);return local;});
  try{
    let root,clips=[];const ext=file.name.split('.').pop().toLowerCase(),data=await file.arrayBuffer();
    if(ext==='glb'||ext==='gltf'){const gltf=await new GLTFLoader(manager).parseAsync(ext==='gltf'?new TextDecoder().decode(data):data,'');root=gltf.scene;clips=gltf.animations;}
    if(ext==='fbx'){root=new FBXLoader(manager).parse(data,'');clips=root.animations||[];}
    if(ext==='obj'){
      const loader=new OBJLoader(manager),mtlFile=files.find(f=>/\.mtl$/i.test(f.name));
      if(mtlFile){const m=new MTLLoader(manager).parse(await mtlFile.text(),'');m.preload();loader.setMaterials(m);}
      root=loader.parse(new TextDecoder().decode(data));
    }
    if(ext==='stl'){root=new THREE.Group();root.add(new THREE.Mesh(new STLLoader().parse(data),new THREE.MeshStandardMaterial({color:'#bfcdb1',roughness:0.5})));}
    project=null;++loadTicket;// Default: live highlights/edges come back from CODEX_* extensions and the baked shells hide.
    // baked=true keeps only the exported geometry visible — exactly what other engines and Roblox will render.
    const restored=baked?0:restoreImportedHighlights(root)+restoreImportedEdges(root);install({root,clips});message(baked?'Showing baked highlight/edge geometry only (as other engines render it)':restored?`Imported ${restored} highlight/edge setting${restored>1?'s':''} from glTF extensions`:'Imported asset');$('asset-type').textContent='IMPORTED ASSET';$('asset-name').textContent=file.name;$('asset-description').textContent='Original units retained · inspect dimensions before export';document.querySelectorAll('.project').forEach(b=>b.classList.remove('active'));$('save').disabled=true;$('recipe').disabled=true;renderParameters();
  }finally{manager.onLoad=()=>{for(const url of urls.values())URL.revokeObjectURL(url);};setTimeout(()=>{for(const url of urls.values())URL.revokeObjectURL(url);},60000);$('files').value='';}
}
// Hybrid preview, GPU half: the discrete GPU renders; under load the render scale drops in 0.25 steps to hold the frame
// rate and climbs back when frames are fast again. Automated runs (webdriver: tests, PNG export) stay at full resolution.
const maxScale=Math.min(devicePixelRatio,2),adaptive=!navigator.webdriver;let renderScale=maxScale,scaleCeiling=maxScale,frameEMA=16.7,adaptClock=0,fastSeconds=0;
function setRenderScale(r){renderScale=r;renderer.setPixelRatio(r);const {width,height}=$('viewport').getBoundingClientRect();renderer.setSize(width,height);fx.setSize(width,height);}
function adaptScale(raw){
  if(!adaptive||document.visibilityState!=='visible'||raw>250)return;
  frameEMA+=(raw-frameEMA)*0.08;if((adaptClock+=raw)<1000)return;adaptClock=0;
  if(frameEMA>28&&renderScale>0.75){if(fastSeconds<3)scaleCeiling=renderScale-0.25;fastSeconds=0;setRenderScale(Math.max(0.75,renderScale-0.25));}
  else if(frameEMA<19&&++fastSeconds>=3&&renderScale<Math.min(maxScale,scaleCeiling)){fastSeconds=0;setRenderScale(Math.min(maxScale,scaleCeiling,renderScale+0.25));}
}
const gpuName=(()=>{const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');const name=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);return String(name).replace(/^ANGLE \((.*)\)$/,'$1').split(',').slice(-2,-1)[0]?.replace(/Direct3D.*$/,'').trim()||String(name);})();
function hardwareLine(){const cpu=lodPanel?.api.cpuThreads??0;return `GPU ${gpuName} · CPU ${cpu||1} worker${cpu===1?'':'s'} · ${Math.round(renderScale*100)}% res`;}
setInterval(()=>{const el=document.querySelector('.viewport-info span:last-child');if(el)el.textContent=hardwareLine();},1000);
// Automated runs (CLI export/GFX, tests) render explicitly when they need a frame, so the idle loop is capped at
// ~12 fps there instead of 60: keeps headless Chromium from burning CPU/GPU between steps.
const automated=navigator.webdriver,minFrame=automated?80:0;
renderer.setAnimationLoop(()=>{
  const now=performance.now();if(now-lastTime<minFrame)return;const raw=now-lastTime,dt=Math.min(raw/1000,0.05);lastTime=now;if(!automated)adaptScale(raw);
  if(playing&&!busy&&action)mixer.update(dt*Number($('speed').value));
  if(topologyOverlay?.visible)topologyOverlay.userData.update();lodPanel?.update();
  fx.time+=dt;updateTime();controls.update();lighting.update(camera);fx.render(scene,camera,panels?.entries??highlightEntries);
});
// Topology tools are part of the production engine, and exposed to Codex as compact reports.
const topoButton=document.createElement('button');topoButton.id='topology';topoButton.innerHTML='△ <span>Topology</span>';topoButton.setAttribute('aria-label','Topology overlay');topoButton.setAttribute('aria-pressed','false');document.querySelector('.view-tools').append(topoButton);
const panel=document.createElement('section');panel.className='topology-panel';panel.innerHTML=`<div class="section-label">SMART TOPOLOGY <span>QUALITY</span></div><div class="quality-card"><div class="q-score"><b id="q-score">–</b><span id="q-grade">·</span><small>TOPOLOGY SCORE</small></div><div id="q-bars"></div></div><p id="q-facts" class="fine"></p><p id="q-tips" class="fine q-tips"></p><div class="section-label lod-head">LOD OPTIMIZER <span id="lod-level">LOD0</span></div><label class="control lod-slider">Reduce triangles <output id="lod-out">0%</output><input id="lod" type="range" min="0" max="95" step="1" value="0" aria-label="Triangle reduction"></label><div class="lod-presets"><button data-lod="LOD0">LOD0</button><button data-lod="LOD1">LOD1 · 50%</button><button data-lod="LOD2">LOD2 · 25%</button><button data-lod="LOD3">LOD3 · 12%</button></div><label class="format-label">Error limit<select id="lod-error" aria-label="LOD error limit"><option value="0.006">Strict · 0.6% of size</option><option value="0.01">Fine · 1%</option><option value="0.015" selected>Balanced · 1.5%</option><option value="0.025">Distant · 2.5%</option><option value="0.04">Aggressive · 4%</option><option value="0.1">Unlimited · 10%</option></select></label><label class="check-row"><input type="checkbox" id="lod-creases" checked><span>Keep hard edges &amp; silhouette creases</span></label><label class="check-row"><input type="checkbox" id="lod-cull"><span>Cull tiny parts (far LODs)</span></label><p id="lod-result" class="fine">Drag to reduce: flat areas go first, silhouette, hard edges, UV seams and skin-weight joints last.</p><button class="full" id="lod-chain">↓ Export LOD chain (LOD0–3 GLB · ZIP)</button><button class="full primary-soft" id="fix-topology">✧ Smart fix · clean · flip · relax</button><button class="full" id="cleanup">Clean only · keep triangle density</button><button class="full" id="undo-optimize" disabled>↶ Undo</button><div id="topology-stats"></div><p class="fine topology-legend">Topology view: amber open · pink non-manifold · purple winding</p><div id="topology-hints" class="fine"></div><button class="full" id="topology-report">↓ Topology + quality report JSON</button><p id="optimization-result" class="fine">Changes affect this session and exports. Codex can apply the same operation in the recipe.</p>`;
document.querySelector('.inspector').insertBefore(panel,document.querySelector('.inspector>section:nth-of-type(3)'));
function setWire(){asset?.root.traverse(o=>{if(o.isMesh)for(const m of(Array.isArray(o.material)?o.material:[o.material]))m.wireframe=materialsWire||topologyVisible;});}
let topologyTicket=0;
// Audits run on the CPU worker pool and fill the per-geometry cache; the main thread only formats the result.
async function refreshTopology(){
  const root=asset?.root,my=++topologyTicket;if(!root)return;await geometryPool().auditAll(root);if(my!==topologyTicket||asset?.root!==root)return;topologyReport=auditTopology(root);const t=topologyReport.total;
  $('topology-stats').replaceChildren();
  for(const [label,value]of [['Triangles',t.triangles.toLocaleString()],['GPU / welded vertices',`${t.gpuVertices.toLocaleString()} / ${t.positionVertices.toLocaleString()}`],['Open / non-manifold edges',`${t.boundaryEdges} / ${t.nonManifoldEdges}`],['Winding conflicts',t.windingEdges],['Degenerate / thin faces',`${t.degenerateTriangles} / ${t.skinnyTriangles}`],['Duplicate faces',t.duplicateTriangles],['Authored source quads',t.sourceQuads]]){
    const row=document.createElement('div');row.className='structure-row';const l=document.createElement('span'),v=document.createElement('b');l.textContent=label;v.textContent=value;row.append(l,v);$('topology-stats').append(row);
  }
  $('topology-hints').textContent=topologyReport.recommendations.slice(0,3).join(' ')||'No edge-connectivity defects found. Check shape and deformation visually.';
  if(topologyOverlay){scene.remove(topologyOverlay);topologyOverlay.userData.dispose();topologyOverlay=null;}
  if(topologyVisible){topologyOverlay=createTopologyOverlay(asset.root);scene.add(topologyOverlay);}
  $('undo-optimize').disabled=!optimizationUndo;lodPanel?.refreshQuality();
  return topologyReport;
}
topoButton.onclick=()=>{topologyVisible=!topologyVisible;topoButton.setAttribute('aria-pressed',String(topologyVisible));setWire();refreshTopology();message(topologyVisible?'Topology: amber open · pink non-manifold · purple winding':'Shaded viewport');};
async function optimizeCurrent(ratio=1){
  if(!asset||busy)return;busy=true;message('Analyzing seams and optimizing geometry…');
  try{
    optimizationUndo?.commit();optimizationUndo=null;lodPanel?.reset();
    const result=await optimizeTopology(asset.root,{ratio,error:0.005,keepUndo:true});optimizationUndo=result;
    stats();refreshTopology();
    $('optimization-result').textContent=`Triangles ${result.before.triangles.toLocaleString()} → ${result.after.triangles.toLocaleString()}; vertices ${result.before.gpuVertices.toLocaleString()} → ${result.after.gpuVertices.toLocaleString()}. Target is a budget, not a guarantee; error and topology constraints take priority.`;
    message('Geometry optimized · undo available · exports use the result');return result;
  }finally{busy=false;}
}
$('cleanup').onclick=guarded(()=>optimizeCurrent(1));
$('undo-optimize').onclick=()=>{optimizationUndo?.undo();optimizationUndo=null;lodPanel?.reset();stats();refreshTopology();$('optimization-result').textContent='Original geometry restored.';message('Optimization undone');};
$('topology-report').onclick=()=>download(JSON.stringify({...topologyReport,quality:lodPanel?.quality},null,2),(project?.id||'asset')+'.topology.json','application/json');
window.codexDesign={ready:false,lighting:(spec)=>spec===undefined?{preset:lighting.name,...lighting.settings}:setLighting(spec),lightingPresets:Object.keys(LIGHTING_PRESETS),hardware:()=>({gpu:gpuName,cpuWorkers:lodPanel?.api.cpuThreads??0,renderScale,adaptive}),load:loadProject,stats:()=>stats(),topology:()=>auditTopology(asset.root),optimize:optimizeCurrent,get root(){return asset?.root;},get clips(){return asset?.clips;},get renderer(){return renderer;},setTime(t){setPlaying(false);mixer.setTime(t);updateTime();},playClip(name){chooseClip(name);},frame,export:exportAsset,async exportBase64(format,options){const r=await exportAsset(format,options);let s='';for(let i=0;i<r.data.length;i+=32768)s+=String.fromCharCode(...r.data.subarray(i,i+32768));return {base64:btoa(s),extension:r.extension};}};
panels=createPanels({$,fx,renderer,camera,getAsset:()=>asset,message,guarded,stats});
lodPanel=createLodPanel({$,scene,getAsset:()=>asset,getProject:()=>project,message,guarded,stats,refreshTopology,getUndo:()=>optimizationUndo,setUndo:r=>{optimizationUndo=r;$('undo-optimize').disabled=!r;},exportAsset,download});
Object.assign(window.codexDesign,lodPanel.api);
Object.assign(window.codexDesign,panels.api,{get highlightRenderer(){return fx;}});
Object.assign(window.codexDesign,createSurfacePanel({$,getAsset:()=>asset,message,guarded,stats}).api);
Object.assign(window.codexDesign,createGfxPanel({$,renderer,scene,lighting,getAsset:()=>asset,getProject:()=>project,message,guarded,download,choreography}).api);
new EventSource('/api/events').onmessage=guarded(async()=>{await refreshProjects();if(project)await loadProject(project.id,{keepView:true});else if(!asset)await loadProject(projects[0].id);});
// ?import=exports/<file>.glb previews an exported file; add &baked=1 to see it without live effects.
async function importURL(url,options){const r=await fetch('/'+url.replace(/^\/+/,''));if(!r.ok)throw new Error(`Cannot fetch ${url}`);await importFiles([new File([await r.blob()],url.split('/').pop())],options);}
window.codexDesign.importURL=guarded(importURL);
await guarded(async()=>{await refreshProjects();const params=new URLSearchParams(location.search),id=params.get('project'),imp=params.get('import');if(imp){await importURL(imp,{baked:params.get('baked')==='1'});return;}await loadProject(projects.find(p=>p.id===id)?.id||'courier');})();
