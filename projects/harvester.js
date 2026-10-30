import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
// HARVESTER — authored from the two supplied reference sheets.
// Metres, Y up, +Z forward. Articulated timber and independently rigged claws.
// All rigid pieces are baked into material batches with exact one-bone weights.
export async function build(k) {
  const T=k.THREE, PI=Math.PI, TAU=PI*2, bones=[], parts=[], B={};
  const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
  const bone=(name,parent,at=[0,0,0])=>{const b=k.bone(name,{parent:parent||k.root,at});bones.push(b);B[name]=b;return b;};
  const hips=bone('Hips',null,[0,1.77,0]), spine=bone('Spine',hips,[0,.32,0]);
  const chest=bone('Chest',spine,[0,.36,0]), neck=bone('Neck',chest,[0,.37,0]);
  const head=bone('Head',neck,[0,.34,0]), stem=bone('Stem',head,[0,.40,0]);
  const noise=(u,v)=>Math.sin(u*127.1+v*311.7)*.5+Math.sin(u*231.7-v*75.3)*.25;
  const bark=k.pbrSurface({name:'Harvester_riven_heartwood',normal:2.3,
    height(u,v){let w=u+.018*Math.sin(v*19)+.012*Math.sin(v*41+u*9);return .45+.19*Math.sin(w*TAU*11)+.09*Math.sin(w*TAU*29)+.03*noise(u*8,v*8);},
    albedo(c){const g=clamp(c.h);return [54+51*g,28+30*g,16+18*g].map(x=>x/255);},roughness:c=>.76+.13*(1-c.h)}, {size:512});
  bark.name='Bark_512_PBR';
  const pumpkin=k.pbrSurface({name:'Harvester_pumpkin_rind',normal:.65,
    height(u,v){return .5+.09*Math.sin(u*TAU*32+Math.sin(v*18))+.04*noise(u*20,v*20);},
    albedo(c){const m=.5+.5*Math.sin(c.u*TAU*10);return [181+49*m+13*c.h,49+35*m+12*c.h,6+8*m].map(x=>x/255);},roughness:c=>.38+.15*c.h},{size:512});
  pumpkin.name='Pumpkin_512_PBR';
  const leaf=k.pbrSurface({name:'Harvester_dry_leaf',normal:1.2,
    height(u,v){return .5+.1*Math.sin((u+v*.4)*120)+.025*noise(u*9,v*9);},
    albedo(c){return [67+35*c.h,83+35*c.h,15+14*c.h].map(x=>x/255);},roughness:()=>.87},{size:256});leaf.name='Leaf_256_PBR';
  const gold=k.material('#d5a334',{metalness:.72,roughness:.3});gold.name='Antique_harvest_gold';
  const vine=k.material('#4f691c',{roughness:.62,metalness:0});vine.name='Living_vine';
  const vein=k.material('#9a9b37',{roughness:.76,metalness:0});vein.name='Leaf_veins';
  const straw=k.material('#c9a363',{roughness:.86,metalness:0});straw.name='Straw';
  const band=k.material('#973b24',{roughness:.7,metalness:0});band.name='Hat_ribbon';
  const shadow=k.material('#11151b',{roughness:.66,metalness:.12});shadow.name='Seeker_shadow';
  const flower=k.material('#e2d5b7',{roughness:.7,metalness:0});flower.name='Ivory_petals';
  const light=k.material('#ffd12f',{emissive:'#ff9c08',emissiveIntensity:k.parameters.lantern,roughness:.5,metalness:0});light.name='Lantern_heart';
  function add(name,g,mat,b,at=[0,0,0],rot=[0,0,0],scale=[1,1,1]) {
    const m=new T.Matrix4().compose(new T.Vector3(...at),new T.Quaternion().setFromEuler(new T.Euler(...rot)),new T.Vector3(...scale));
    parts.push({name,g:g.clone().applyMatrix4(m),mat,b});
  }
  const ball=(name,b,at,sc,mat,n=12)=>add(name,new T.SphereGeometry(1,n,8),mat,b,at,[0,0,0],sc);
  function rod(name,b,a,z,r1,r2,mat,n=10){const av=new T.Vector3(...a),bv=new T.Vector3(...z),d=bv.clone().sub(av);const g=new T.CylinderGeometry(r2,r1,d.length(),n,1);g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.clone().normalize()));g.translate(...av.add(bv).multiplyScalar(.5).toArray());add(name,g,mat,b);}
  function tube(name,b,pts,r,mat,segs=20,sides=6){add(name,new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(p=>new T.Vector3(...p))),segs,r,sides,false),mat,b);}
  function poly(name,b,pts,mat,depth=.012,at=[0,0,0],rot=[0,0,0],holes=[]){const s=new T.Shape(pts.map(p=>new T.Vector2(...p)));for(const h of holes)s.holes.push(new T.Path(h.map(p=>new T.Vector2(...p))));const g=new T.ExtrudeGeometry(s,{depth,bevelEnabled:false,curveSegments:1,steps:1});if(name.startsWith('Tattered_leaf')){const p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i);p.setZ(i,p.getZ(i)-.36*x*x+.018*Math.sin(y*12+x*4));}g.computeVertexNormals();}add(name,g,mat,b,at,rot);}
  function timber(name,b,top,bot,r0,r1,sz=1) {
    const a=new T.Vector3(...top),z=new T.Vector3(...bot),d=z.clone().sub(a),g=new T.CylinderGeometry(r0,r1,d.length(),12,5);
    const p=g.attributes.position;
    for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),zz=p.getZ(i),angle=Math.atan2(zz,x),wav=1+.055*Math.sin(angle*5+y*7)+.028*Math.cos(angle*9-y*5);p.setXYZ(i,x*wav,y,zz*wav*sz);}
    g.computeVertexNormals();g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),a.clone().sub(z).normalize()));g.translate(...a.add(z).multiplyScalar(.5).toArray());add(name,g,bark,b);
  }
  function knot(b,at,size=.08){add('Endgrain_knot',new T.TorusGeometry(size,.012,5,16),bark,b,at);ball('Knot_core',b,at,[size*.7,size*.92,.015],bark);}
  function spiral(name,b,ry,rx,rz,y0,y1,turns=1.2,phase=0){const pts=[];for(let i=0;i<=28;i++){const t=i/28,a=t*TAU*turns+phase;pts.push([Math.sin(a)*rx,y0+(y1-y0)*t,Math.cos(a)*rz]);}tube(name,b,pts,ry,vine,32,6);return pts;}
  function tinyLeaf(b,at,rot,size=.09){poly('Vine_leaf',b,[[0,0],[-size*.5,size*.3],[-size*.38,size*.7],[0,size],[size*.4,size*.58],[size*.45,size*.2]],leaf,.005,at,rot);}
  function blossom(b,at){for(let i=0;i<5;i++){const a=i*TAU/5;ball('Blossom_petal',b,[at[0]+Math.cos(a)*.024,at[1]+Math.sin(a)*.024,at[2]],[.022,.016,.01],flower,8);}ball('Blossom_heart',b,[at[0],at[1],at[2]+.011],[.014,.014,.011],gold,8);}
  // Tall, tapered timber anatomy, with visible organic socket joints.
  timber('Pelvis',hips,[0,.08,0],[0,-.23,0],.28,.23,.73);
  timber('Abdomen',spine,[0,.27,0],[0,-.25,0],.27,.23,.70);
  timber('Thorax',chest,[0,.26,0],[0,-.2,0],.39,.27,.59);
  timber('Neck_trunk',neck,[0,.18,0],[0,-.14,0],.10,.13,.95);
  knot(hips,[.06,-.04,.199],.065);knot(spine,[-.11,.04,.184],.055);
  // Torn leaf poncho, actual cutout holes rather than painted black scratches.
  const outline=[[-.40,.23],[-.25,.19],[-.18,.24],[-.08,.18],[.04,.23],[.16,.17],[.32,.25],[.39,.15],[.33,.04],[.40,-.02],[.28,-.04],[.33,-.13],[.22,-.09],[.19,-.23],[.11,-.18],[.06,-.31],[-.02,-.22],[-.09,-.25],[-.15,-.15],[-.24,-.20],[-.23,-.08],[-.36,-.11],[-.29,-.02],[-.4,.04]];
  const cuts=[[[.23,.12],[-.16,-.01],[-.24,-.09],[-.07,-.025]],[[.12,.02],[-.06,-.14],[.01,-.08],[.20,.04]],[[-.27,.12],[-.18,.09],[-.12,.11]],[[.24,-.08],[.27,-.12],[.25,-.15]]];
  poly('Tattered_leaf_front',chest,outline,leaf,.014,[0,0,.235],[0,0,0],cuts);
  poly('Tattered_leaf_back',chest,outline.map(([x,y])=>[x,y*.9]),leaf,.014,[0,0,-.24],[0,PI,0]);
  tube('Leaf_midrib',chest,[[-.27,-.12,.256],[-.13,-.02,.257],[.08,.13,.257],[.30,.24,.257]],.008,vein,12,5);
  for(let i=0;i<5;i++)tube('Leaf_secondary_vein',chest,[[-.23+i*.095,-.10+i*.07,.257],[-.28+i*.1,.02+i*.04,.257]],.0035,vein,2,4);
  for(const s of [-1,1])poly('Shoulder_leaf',chest,[[0,0],[.15,.01],[.13,.25],[.06,.31],[-.02,.2]],leaf,.01,[s*.31,.12,-.19],[-PI/2,0,s*.2]);
  // Pumpkin: ten sculpted lobes with genuine carved openings through the rind.
  let pg=new T.SphereGeometry(1,64,32),pp=pg.attributes.position;
  for(let i=0;i<pp.count;i++){const x=pp.getX(i),y=pp.getY(i),z=pp.getZ(i),a=Math.atan2(x,z),f=.91+.09*Math.cos(a*10);pp.setXYZ(i,x*.47*f,y*.405,z*.405*f);}
  pg.computeVertexNormals();let shell=k.mesh('Pumpkin_CSG_Base',pg,null,pumpkin);
  const eyeR=[[.065,.015],[.15,.105],[.325,.18],[.28,.07],[.19,.015],[.10,-.005]];
  const eyeL=eyeR.map(([x,y])=>[-x,y]);
  const mouth=[[-.32,-.105],[-.23,-.17],[-.17,-.165],[-.135,-.195],[-.08,-.181],[-.045,-.212],[.01,-.192],[.055,-.215],[.11,-.18],[.155,-.19],[.20,-.153],[.25,-.15],[.315,-.095],[.272,-.215],[.215,-.25],[.16,-.255],[.135,-.281],[.075,-.262],[.045,-.291],[-.01,-.267],[-.06,-.286],[-.10,-.257],[-.16,-.26],[-.19,-.228],[-.24,-.23],[-.29,-.18]];
  for(const [j,points] of [eyeL,eyeR,mouth].entries()){const shape=new T.Shape(points.map(p=>new T.Vector2(...p)));const cut=k.mesh('Carving_tool_'+j,new T.ExtrudeGeometry(shape,{depth:.55,bevelEnabled:false}),null,pumpkin,{at:[0,0,.055]});shell.material=pumpkin;shell=k.csg('Pumpkin_carve_'+j,shell,cut);shell.material=pumpkin;}
  add('Carved_pumpkin',shell.geometry,pumpkin,head);shell.removeFromParent();
  // Deep inset amber volumes illuminate the three apertures. Glow is in the reference.
  for(const [j,pts] of [eyeL,eyeR,mouth].entries())poly('Lantern_inset_'+j,head,pts,light,.015,[0,0,.205]);
  tube('Curl_stem',stem,[[0,-.03,0],[-.035,.11,0],[-.03,.24,0],[.025,.34,0],[.12,.36,0],[.17,.30,0],[.15,.23,0],[.09,.21,0],[.065,.25,0],[.09,.275,0]],.034,bark,32,8);
  tube('Stem_green_tip',stem,[[.015,.30,.025],[.11,.34,.025],[.145,.29,.025],[.125,.24,.025],[.09,.245,.025]],.018,vine,14,6);
  tinyLeaf(stem,[-.045,.14,.01],[0,0,.8],.11);
  // Hip loops, blossoms, berries and the straw hat with concentric woven brim.
  for(let j=0;j<3;j++)spiral('Hip_vine',hips,.021,.32+j*.025,.215+j*.012,.11-j*.08,-.18-j*.05,.82,j*1.8);
  tube('Draped_vine',hips,[[-.29,.1,0],[-.38,-.12,.14],[-.26,-.35,.24],[0,-.40,.27],[.29,-.2,.20],[.32,.15,0]],.023,vine,26,7);
  for(let i=0;i<5;i++){const a=i*1.1;blossom(hips,[Math.sin(a)*.33,-.10+Math.cos(a)*.09,Math.cos(a)*.23]);tinyLeaf(hips,[Math.sin(a)*.35,-.18,Math.cos(a)*.24],[0,a,.4],.105);}
  const hat=bone('StrawHat',hips,[.34,.02,.04]);hat.rotation.set(.22,0,-.85);
  add('Hat_brim',new T.CylinderGeometry(.255,.262,.025,32),straw,hat,[0,0,0],[PI/2,0,0]);
  add('Hat_crown',new T.CylinderGeometry(.14,.18,.105,24),straw,hat,[0,0,.07],[PI/2,0,0]);
  add('Hat_red_ribbon',new T.CylinderGeometry(.177,.182,.033,24),band,hat,[0,0,.032],[PI/2,0,0]);
  for(let j=0;j<5;j++)add('Woven_brim_ring',new T.TorusGeometry(.19+j*.014,.003,4,32),vein,hat,[0,0,.015]);
  for(let j=0;j<12;j++){const a=j*TAU/12;rod('Straw_seam',hat,[.19*Math.cos(a),.19*Math.sin(a),.018],[.252*Math.cos(a),.252*Math.sin(a),.018],.002,.002,vein,4);}
  // Paired limbs and fully jointed long claws.
  const fingerBones=[];
  for(const s of [-1,1]){
    const tag=s<0?'R':'L',arm=bone('UpperArm'+tag,chest,[s*.44,.17,0]);arm.rotation.z=s*.09;
    const elbow=bone('Forearm'+tag,arm,[0,-.56,0]),hand=bone('Hand'+tag,elbow,[0,-.54,0]);
    ball('Shoulder_socket',arm,[0,0,0],[.145,.15,.145],bark);timber('Upper_arm_timber',arm,[0,-.08,0],[0,-.51,0],.096,.076);
    ball('Elbow_socket',elbow,[0,0,0],[.092,.10,.09],bark);timber('Forearm_timber',elbow,[0,-.06,0],[0,-.51,0],.088,.061);
    for(let j=0;j<3;j++){const y=-.15-j*.14;rod('Branch_thorn',arm,[s*.08,y,0],[s*(.15+(j%2)*.025),y+.05,.012],.028,0,bark,6);rod('Forearm_thorn',elbow,[s*.08,y,0],[s*.15,y+.05,.01],.023,0,straw,6);}
    // Open-ended jagged gold cuffs use an explicit low density ring surface.
    function cuff(b,y,r){const verts=[],uv=[],ix=[],n=20;for(let j=0;j<2;j++)for(let i=0;i<=n;i++){let a=i/n*TAU;verts.push(Math.cos(a)*r*(j?1.13:1),y+j*.10+(j&&i%4===0?.07:0),Math.sin(a)*r);uv.push(i/n,j);}for(let i=0;i<n;i++){const a=i,b=i+1,c=i+n+1,d=c+1;ix.push(a,c,b,b,c,d);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();add('Jagged_gold_cuff',g,gold,b);}
    cuff(hand,-.015,.077);ball('Palm',hand,[0,-.095,.006],[.096,.125,.048],gold);
    for(let f=0;f<5;f++){
      const thumb=f===4,x=thumb?-s*.105:(f-1.5)*.047,len=thumb?.082:.095+(f===1||f===2?.023:0);
      const fb=bone('Finger'+tag+f,hand,[x,thumb?-.07:-.18,.005]);fb.rotation.z=thumb?-s*.65:(f-1.5)*.08;
      const mid=bone('FingerMid'+tag+f,fb,[0,-len,0]),tip=bone('FingerTip'+tag+f,mid,[0,-len*.72,.015]);fingerBones.push([fb,mid,tip,tag]);
      rod('Gold_proximal_phalanx',fb,[0,0,0],[0,-len,0],.021,.016,gold,8);ball('Finger_knuckle',fb,[0,0,0],[.025,.024,.025],gold,8);
      rod('Gold_middle_phalanx',mid,[0,0,0],[0,-len*.72,.015],.017,.012,gold,8);ball('Middle_knuckle',mid,[0,0,0],[.02,.021,.02],gold,8);
      rod('Tapered_finger_talon',tip,[0,0,0],[0,-.088,.055],.014,.001,gold,8);
    }
    const thigh=bone('Thigh'+tag,hips,[s*.18,-.19,0]);thigh.rotation.z=s*.055;
    const shin=bone('Shin'+tag,thigh,[0,-.72,0]),foot=bone('Foot'+tag,shin,[0,-.72,0]);
    ball('Hip_socket',thigh,[0,0,0],[.15,.15,.13],bark);timber('Thigh_timber',thigh,[0,-.07,0],[0,-.65,0],.145,.11,.9);
    ball('Knee_socket',shin,[0,0,0],[.13,.13,.12],bark);ball('Kneecap',shin,[0,-.015,.105],[.095,.14,.035],bark);
    timber('Shin_timber',shin,[0,-.09,0],[0,-.68,0],.105,.067,.92);
    spiral('Thigh_vine',thigh,.016,.155,.143,-.08,-.61,1.1,s);spiral('Shin_vine',shin,.014,.118,.112,-.10,-.65,.95,s+.5);
    tinyLeaf(thigh,[s*.14,-.25,.04],[0,s*.5,-s*.5],.12);knot(thigh,[s*.015,-.28,.136],.043);
    cuff(foot,-.005,.083);ball('Gold_instep',foot,[0,-.025,.085],[.10,.09,.15],gold);
    for(let f=0;f<4;f++){const toe=bone('Toe'+tag+f,foot,[(f-1.5)*.052,-.055,.17]);rod('Toe_phalanx',toe,[0,0,0],[0,-.012,.095],.025,.019,gold,8);ball('Toe_joint',toe,[0,-.012,.09],[.024,.024,.025],gold,8);rod('Toe_claw',toe,[0,-.012,.105],[0,-.04,.22-(Math.abs(f-1.5)*.025)],.019,.001,gold,8);}
  }
  // Seeker: a small dimensional silhouette companion with independent wing/fan rig.
  const crow=bone('Seeker',chest,[-.49,.35,-.035]),crowHead=bone('SeekerHead',crow,[-.025,.18,.045]);
  ball('Seeker_body',crow,[0,.10,0],[.077,.12,.09],shadow);ball('Seeker_head',crowHead,[0,0,0],[.068,.065,.067],shadow);
  rod('Seeker_beak',crowHead,[0,-.005,.055],[0,-.023,.15],.038,0,shadow,6);
  for(const s of [-1,1]){ball('Seeker_amber_eye',crowHead,[s*.056,.014,.037],[.012,.014,.009],light,8);rod('Seeker_leg',crow,[s*.028,0,0],[s*.032,-.055,.025],.008,.007,shadow,6);for(let i=-1;i<=1;i++)rod('Seeker_toe',crow,[s*.032,-.055,.025],[s*.032+i*.02,-.062,.069],.006,.002,shadow,5);
    const wing=bone(s<0?'SeekerWingR':'SeekerWingL',crow,[s*.06,.12,0]);poly('Seeker_wing',wing,[[0,.02],[s*.07,.01],[s*.12,-.12],[s*.09,-.10],[s*.085,-.16],[s*.045,-.13],[s*.015,-.17],[-s*.015,-.03]],shadow,.018,[0,0,-.04]);}
  poly('Seeker_tail',crow,[[-.04,0],[-.07,-.13],[-.025,-.115],[0,-.145],[.026,-.12],[.065,-.13],[.04,0]],shadow,.016,[0,.08,-.07],[-.8,0,0]);
  // Batch by material. No invisible per-piece objects, no duplicate render passes.
  k.root.updateMatrixWorld(true);const groups=new Map();
  for(const p of parts){let g=p.g.index?p.g.toNonIndexed():p.g.clone();g.applyMatrix4(p.b.matrixWorld);g.clearGroups();for(const a of Object.keys(g.attributes))if(!['position','normal','uv'].includes(a))g.deleteAttribute(a);if(!g.attributes.uv)g.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
    const si=[],sw=[],idx=bones.indexOf(p.b);for(let i=0;i<g.attributes.position.count;i++){si.push(idx,0,0,0);sw.push(1,0,0,0);}g.setAttribute('skinIndex',new T.Uint16BufferAttribute(si,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(sw,4));
    if(!groups.has(p.mat))groups.set(p.mat,[]);groups.get(p.mat).push(g);}
  const skeleton=new T.Skeleton(bones);
  for(const [mat,geos]of groups){const g=mergeVertices(k.mergeGeometries(geos,false),1e-6); const clean=[],pos=g.attributes.position,ix=g.index.array,a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(); for(let i=0;i<ix.length;i+=3){a.fromBufferAttribute(pos,ix[i]);b.fromBufferAttribute(pos,ix[i+1]);c.fromBufferAttribute(pos,ix[i+2]);if(b.sub(a).cross(c.sub(a)).lengthSq()>1e-16)clean.push(ix[i],ix[i+1],ix[i+2]);}g.setIndex(clean);const mesh=new T.SkinnedMesh(g,mat);mesh.name=mat.name+'_Skinned';mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;k.root.add(mesh);mesh.bind(skeleton);}
  // Exportable animation, sampled at 30fps. Every clip keys all joints to avoid residue.
  const rest=new Map(bones.map(b=>[b.name,{p:b.position.toArray(),r:[b.rotation.x,b.rotation.y,b.rotation.z]}]));
  function animate(name,dur,pose,loop=false){const tracks=[];for(const b of bones){const r=rest.get(b.name);tracks.push(k.sample(b,'rotation',dur,30,t=>{const p=pose(t/dur,t)||{},v=p[b.name]||[0,0,0];return r.r.map((x,i)=>x+v[i]);}));if(b===hips||b===crow)tracks.push(k.sample(b,'position',dur,30,t=>{const p=pose(t/dur,t)||{},v=p[b.name+'Pos']||[0,0,0];return r.p.map((x,i)=>x+v[i]);}));}k.clip(name,dur,tracks).optimize();k.clips.at(-1).userData={loop};}
  const fingers=(p,c,side)=>{for(const [a,b,d,t] of fingerBones)if(!side||t===side){p[a.name]=[c*.45,0,0];p[b.name]=[c*.8,0,0];p[d.name]=[c*.6,0,0];}return p;};
  const idle=(u)=>({Spine:[.018*Math.sin(u*TAU),0,.012*Math.sin(u*TAU)],Head:[.025*Math.sin(u*TAU),.07*Math.sin(u*TAU),-.025],Stem:[.025*Math.sin(u*TAU+.4),0,.03*Math.sin(u*TAU)],SeekerHead:[0,.15*Math.sin(u*TAU),0],StrawHat:[0,0,.02*Math.sin(u*TAU)]});
  animate('01_Idle_Breathing',4,u=>fingers(idle(u),.15+.06*Math.sin(u*TAU)),true);
  animate('02_Idle_Observe',5,u=>({...idle(u),Head:[.08*Math.sin(u*TAU),.48*Math.sin(u*TAU),.08*Math.sin(u*TAU)],SeekerHead:[0,-.6*Math.sin(u*TAU),0]}),true);
  function gait(u,run=false){const a=u*TAU,p={HipsPos:[0,(run?.035:.018)*(1-Math.cos(a*2)),0],Spine:[run?.17:.04,.045*Math.sin(a),.025*Math.cos(a)],Chest:[0,-.07*Math.sin(a),0],Head:[run?-.12:-.035,.04*Math.sin(a),0],StrawHat:[.06*Math.cos(a),0,.05*Math.sin(a)]};for(const [j,tag]of ['L','R'].entries()){const v=a+j*PI,s=Math.sin(v);p['Thigh'+tag]=[s*(run?.8:.45),0,0];p['Shin'+tag]=[Math.max(0,-s)*(run?1.2:.64),0,0];p['Foot'+tag]=[-Math.max(0,-s)*.35,0,0];p['UpperArm'+tag]=[-s*(run?.7:.37)-(run?.18:0),0,0];p['Forearm'+tag]=[run?-.85:-.18,0,0];p['Hand'+tag]=[.1*Math.sin(v+.5),0,0];}return fingers(p,run?.8:.3);}
  animate('03_Walk',1.4,u=>gait(u),true);animate('04_Run',.8,u=>gait(u,true),true);
  animate('05_Stalk',2.3,u=>{const p=gait(u);p.HipsPos[1]-=.12;p.Spine=[.25,0,0];p.Head=[-.2,.08*Math.sin(u*TAU),0];p.ForearmL=[-.6,0,0];p.ForearmR=[-.6,0,0];return p;},true);
  const env=(u,a,b,c,d)=>u<a?0:u<b?(u-a)/(b-a):u<c?1:u<d?1-(u-c)/(d-c):0;
  animate('06_Claw_Slash',1.35,u=>{const w=env(u,.05,.28,.38,.85),hit=env(u,.30,.42,.55,.88);return fingers({Chest:[.05,-.5*w+1.0*hit,0],Head:[0,.25*w-.4*hit,0],UpperArmR:[-1.1*w+.5*hit,-.4*w,-.75*w],ForearmR:[-.9*w+.7*hit,0,0],HandR:[0,0,.4*hit],ThighL:[-.12*hit,0,0]},.6,'R');});
  animate('07_Double_Rake',1.8,u=>{const w=env(u,.03,.30,.43,.85),h=env(u,.34,.45,.56,.8);return fingers({Spine:[-.15*w+.5*h,0,0],Head:[-.10*h,0,0],UpperArmL:[-1.85*w+.85*h,0,.35*w],UpperArmR:[-1.85*w+.85*h,0,-.35*w],ForearmL:[-.5*w,0,0],ForearmR:[-.5*w,0,0],HipsPos:[0,-.12*h,0]},1.1);});
  animate('08_Ground_Reap',2.4,u=>{const w=env(u,.04,.3,.5,.9),h=env(u,.42,.51,.62,.9);return fingers({HipsPos:[0,-.28*w,0],Spine:[.15*w+.65*h,0,0],ThighL:[-.45*w,0,0],ThighR:[-.45*w,0,0],ShinL:[.85*w,0,0],ShinR:[.85*w,0,0],UpperArmL:[-2.4*w+1.9*h,0,.16*w],UpperArmR:[-2.4*w+1.9*h,0,-.16*w],Head:[-.25*h,0,0]},.8);});
  animate('09_Seeker_Command',3.6,u=>{const w=env(u,.03,.25,.68,.98),flap=Math.sin(u*TAU*7)*w;return {Head:[0,-.25*w,0],UpperArmR:[-1.2*w,0,-.4*w],ForearmR:[-.45*w,0,0],SeekerPos:[-.2*w,.5*w,.28*w],SeekerWingL:[0,0,1.1*w+flap*.5],SeekerWingR:[0,0,-1.1*w-flap*.5],SeekerHead:[0,.4*Math.sin(u*TAU)*w,0]};});
  animate('10_Seeker_Flap',1.2,u=>({SeekerPos:[0,.055*(1-Math.cos(u*TAU)),0],SeekerWingL:[0,0,.9+.8*Math.sin(u*TAU)],SeekerWingR:[0,0,-.9-.8*Math.sin(u*TAU)]}),true);
  animate('11_Taunt',3.4,u=>{const w=env(u,0,.25,.7,1);return fingers({Chest:[-.09*w,0,0],Head:[-.12*w,.23*Math.sin(u*TAU*2)*w,.12*w],UpperArmL:[-.25*w,0,1.1*w],UpperArmR:[-.25*w,0,-1.1*w],ForearmL:[-1*w,0,0],ForearmR:[-1*w,0,0]},.5+.5*Math.sin(u*TAU*3)*w);});
  animate('12_Hit_Recoil',.85,u=>{const w=env(u,0,.16,.25,1);return {Spine:[-.23*w,0,0],Chest:[-.15*w,.2*w,0],Head:[-.32*w,0,-.15*w],UpperArmL:[.22*w,0,.18*w],UpperArmR:[.22*w,0,-.18*w],Stem:[-.2*w,0,0]};});
  animate('13_Stagger',1.9,u=>{const w=Math.sin(PI*u);return {HipsPos:[.10*Math.sin(u*TAU)*w,-.12*w,0],Spine:[.17*w,0,.16*Math.sin(u*TAU)*w],Head:[.15*w,0,-.2*Math.sin(u*TAU)*w],ThighL:[-.3*w,0,0],ShinL:[.6*w,0,0],UpperArmL:[0,0,.4*w],UpperArmR:[0,0,-.4*w]};});
  animate('14_Spawn_Awaken',3,u=>{const w=1-clamp(u/.85),f=Math.sin(u*PI);return fingers({HipsPos:[0,-.51*w,0],ThighL:[-.8*w,0,0],ThighR:[-.8*w,0,0],ShinL:[1.35*w,0,0],ShinR:[1.35*w,0,0],Spine:[.65*w,0,0],Head:[.45*w,0,0],UpperArmL:[-.4*w,0,.16*f],UpperArmR:[-.4*w,0,-.16*f],SeekerHead:[.25*w,0,0]},w);});
  animate('15_Death_Kneel',2.8,u=>{const w=clamp(u/.7),fall=clamp((u-.35)/.5);return fingers({HipsPos:[0,-.54*w,-.04*w],ThighL:[-.9*w,0,0],ThighR:[-.9*w,0,0],ShinL:[1.6*w,0,0],ShinR:[1.6*w,0,0],FootL:[-.5*w,0,0],FootR:[-.5*w,0,0],Spine:[.65*fall,0,0],Head:[.6*fall,.17*fall,.1*fall],UpperArmL:[-.15*fall,0,.10*w],UpperArmR:[-.15*fall,0,-.10*w],SeekerPos:[-.6*fall,1.6*fall,-.5*fall],SeekerWingL:[0,0,fall*(1+Math.sin(u*TAU*6)*.6)],SeekerWingR:[0,0,-fall*(1+Math.sin(u*TAU*6)*.6)]},.4*fall);});
  animate('16_Victory',4,u=>{const w=env(u,0,.3,.7,1);return fingers({Chest:[-.1*w,0,0],Head:[-.2*w,.3*Math.sin(u*TAU)*w,0],UpperArmL:[-2.4*w,0,.3*w],UpperArmR:[-2.4*w,0,-.3*w],ForearmL:[-.35*w,0,0],ForearmR:[-.35*w,0,0],SeekerWingL:[0,0,.8*w],SeekerWingR:[0,0,-.8*w]},w);});
  animate('17_Inspect_Claws',3.8,u=>{const w=env(u,0,.22,.75,1);return fingers({UpperArmL:[-.9*w,0,-.15*w],ForearmL:[-1.3*w,0,0],HandL:[0,.5*w,.1*w],Head:[.3*w,.3*w,0]},(.6+.5*Math.sin(u*TAU*3))*w,'L');});
  animate('18_Turn_Alert',2.2,u=>{const w=Math.sin(PI*u);return {Head:[0,.9*w,0],Chest:[0,.3*w,0],Spine:[0,.12*w,0],SeekerHead:[0,-.6*w,0],HandL:[.15*w,0,0],HandR:[.15*w,0,0]};});
  k.root.userData={author:'Codex Design',units:'meters',forward:'+Z',reference:'Two supplied Harvester concepts',rig:'Rigid-weight timber and gold phalanges; 18 authored clips',optimization:'Material-batched skinned geometry; 6-12 sided limb detail; 512px hero textures',animationNotes:'Locomotion is in place. Spawn and death are one-shots. No Roblox AnimationIds are published.'};
}


