import { addAnimations } from './megalodon-abyss.anim.js';

export async function build(k) {
  const T=k.THREE,S=k.STUD,cell=.25;
  const palette={back:'#344b60',side:'#527b9a',scar:'#bdc7d0',belly:'#e6e1d7',gum:'#a52f47',mouth:'#25121d',tooth:'#fff5e2',black:'#09121b',eye:'#ffd052'};
  const matKeys=Object.keys(palette),mats=[];
  for(const key of matKeys){const m=await k.studMaterial(palette[key],{style:'kek',normalScale:.68,roughness:.61,metalness:0,brighten:true});m.name='SquareRoblox_'+key;if(key==='eye'){m.emissive.set('#ffba20');m.emissiveIntensity=2.5;}mats.push(m);}
  const mi=key=>matKeys.indexOf(key),pt=a=>a.map(v=>v*S);
  const bones=[],world=new Map();
  function bone(name,parent,p){const pp=parent?world.get(parent):[0,0,0],b=k.bone(name,{parent:parent||k.root,at:pt(p.map((v,i)=>v-pp[i]))});world.set(b,p);bones.push(b);return b;}
  const root=bone('Root',null,[0,0,0]),skull=bone('Skull',root,[0,0,4.7]),jaw=bone('Jaw_Hinge',skull,[0,-.6,4.45]);
  const zJoints=[3.4,2.1,.6,-1,-2.6,-4.1,-5.5,-6.6],spine=[];
  zJoints.forEach((z,i)=>spine.push(bone('Spine_'+String(i+1).padStart(2,'0'),i?spine[i-1]:root,[0,0,z])));
  const tail=bone('Tail_Peduncle',spine[7],[0,0,-6.7]);
  const tailUpper=bone('Tail_Upper',tail,[0,.25,-6.95]),tailLower=bone('Tail_Lower',tail,[0,-.25,-6.95]);
  const dorsal=bone('Dorsal',spine[2],[0,1.35,.6]),dorsal2=bone('Dorsal_Secondary',spine[5],[0,.55,-3.9]);
  const pecL=bone('Pectoral_L',spine[1],[-1.25,-.65,2.6]),pecR=bone('Pectoral_R',spine[1],[1.25,-.65,2.6]);
  const pecTipL=bone('Pectoral_L_Tip',pecL,[-2.75,-.85,.15]),pecTipR=bone('Pectoral_R_Tip',pecR,[2.75,-.85,.15]);
  const pelvicL=bone('Pelvic_L',spine[4],[-.8,-.75,-2.7]),pelvicR=bone('Pelvic_R',spine[4],[.8,-.75,-2.7]),anal=bone('Anal',spine[5],[0,-.5,-4.2]);
  const gillsL=[],gillsR=[];
  for(let i=0;i<5;i++){gillsL.push(bone('Gill_L_'+(i+1),spine[0],[-1.5,0,3.875-i*.5]));gillsR.push(bone('Gill_R_'+(i+1),spine[0],[1.5,0,3.875-i*.5]));}
  const index=b=>bones.indexOf(b),rigid=b=>()=>[[index(b),1]],clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
  const stations=[4.7,...zJoints,-6.7],chain=[skull,...spine,tail];
  function bodyWeights(v){const z=v.z/S;if(z>=stations[0])return [[index(skull),1]];for(let i=0;i<stations.length-1;i++)if(z>=stations[i+1]){const w=smooth((stations[i]-z)/(stations[i]-stations[i+1]));return [[index(chain[i]),1-w],[index(chain[i+1]),w]];}return [[index(tail),1]];}
  function builder(){const p=[],uv=[],byMat=matKeys.map(()=>[]);let quads=0;return {
    face(vertices,key){const start=p.length/3,a=new T.Vector3(...vertices[0]),b=new T.Vector3(...vertices[1]),c=new T.Vector3(...vertices[2]),u=b.clone().sub(a).normalize(),n=b.clone().sub(a).cross(c.clone().sub(a)).normalize(),v=n.clone().cross(u);for(const q of vertices){p.push(...pt(q));const r=new T.Vector3(...q);uv.push(r.dot(u)/cell,r.dot(v)/cell);}const out=byMat[mi(key)];if(vertices.length===4){out.push(start,start+1,start+2,start,start+2,start+3);quads++;}else out.push(start,start+1,start+2);},
    finish(){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));let idx=[];byMat.forEach((a,i)=>{if(a.length){g.addGroup(idx.length,a.length,i);idx.push(...a);}});g.setIndex(idx);g.computeVertexNormals();g.userData.sourceQuads=quads;return g;}
  };}
  function addSkin(name,g,weight){return k.skin(name,g,mats,bones,weight);}
  function boxTo(b,size,at,key,rot=[0,0,0]){const [w,h,d]=size.map(v=>v/2),corners=[[-w,-h,-d],[w,-h,-d],[w,h,-d],[-w,h,-d],[-w,-h,d],[w,-h,d],[w,h,d],[-w,h,d]],q=new T.Quaternion().setFromEuler(new T.Euler(...rot));const p=corners.map(a=>new T.Vector3(...a).applyQuaternion(q).add(new T.Vector3(...at)).toArray());for(const ids of [[0,3,2,1],[5,6,7,4],[1,2,6,5],[4,7,3,0],[3,7,6,2],[4,0,1,5]])b.face(ids.map(i=>p[i]),key);}
  function box(name,size,at,key,b,rot){const g=builder();boxTo(g,size,at,key,rot);return addSkin(name,g.finish(),rigid(b));}
  function voxel(name,min,max,step,inside,color,weights){const occ=new Set(),lo=min.map(v=>Math.floor(v/step)),hi=max.map(v=>Math.ceil(v/step));for(let i=lo[0];i<hi[0];i++)for(let j=lo[1];j<hi[1];j++)for(let l=lo[2];l<hi[2];l++)if(inside((i+.5)*step,(j+.5)*step,(l+.5)*step))occ.add(`${i},${j},${l}`);const b=builder();
    const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for(const key of occ){const [i,j,l]=key.split(',').map(Number),x=i*step,y=j*step,z=l*step,X=x+step,Y=y+step,Z=z+step;const faces=[[[X,y,z],[X,Y,z],[X,Y,Z],[X,y,Z]],[[x,y,Z],[x,Y,Z],[x,Y,z],[x,y,z]],[[x,Y,Z],[X,Y,Z],[X,Y,z],[x,Y,z]],[[x,y,z],[X,y,z],[X,y,Z],[x,y,Z]],[[X,y,Z],[X,Y,Z],[x,Y,Z],[x,y,Z]],[[x,y,z],[x,Y,z],[X,Y,z],[X,y,z]]];dirs.forEach((d,di)=>{if(!occ.has(`${i+d[0]},${j+d[1]},${l+d[2]}`))b.face(faces[di],color(x+step/2,y+step/2,z+step/2,d));});}
    return addSkin(name,b.finish(),weights);
  }
  const profile=[[-6.75,.24,.24,-.24],[-5.75,.4,.4,-.35],[-4.5,.66,.7,-.55],[-3,1.02,1.05,-.85],[-1.5,1.38,1.35,-1.05],[0,1.6,1.6,-1.3],[2,1.75,1.7,-1.4],[4,1.7,1.6,-1.35],[4.5,1.65,1.5,-1.1],[6,1.5,1.25,-.2],[7.5,1.3,1,-.15],[8.5,1.05,.8,-.1]];
  function radius(z){for(let i=0;i<profile.length-1;i++)if(z<=profile[i+1][0]){const a=profile[i],b=profile[i+1],w=clamp((z-a[0])/(b[0]-a[0]));return a.slice(1).map((v,j)=>v+(b[j+1]-v)*w);}return profile.at(-1).slice(1);}
  const gillZ=[3.875,3.375,2.875,2.375,1.875];
  voxel('Hull_Continuous_Voxel_Skin',[-1.8,-1.5,-6.75],[1.8,1.8,8.5],cell,(x,y,z)=>{
    const [w,top,bottom]=radius(z),mid=(top+bottom)/2,h=(top-bottom)/2;if(Math.pow(Math.abs(x)/w,4)+Math.pow(Math.abs(y-mid)/h,4)>1)return false;
    if(z>4.25&&y<-.12)return false;
    if(z>5.95&&z<7.3&&y>.25&&y<1.0&&Math.abs(x)>1.02)return false;
    if(gillZ.some(g=>Math.abs(z-g)<.13)&&y>-.75&&y<.9&&Math.abs(x)>1.25)return false;
    return true;
  },(x,y,z,d)=>{
    if(z>5.8&&z<7.35&&y>.25&&y<1.0&&Math.abs(x)>.9)return 'black';
    if(gillZ.some(g=>Math.abs(z-g)<.13)&&y>-.75&&y<.9&&Math.abs(x)>1.1)return 'black';
    if(y<-.55||z>4.3&&y<.125)return 'belly';
    const scar=1.15-.95*(1.2-z);if(z>-.6&&z<1.5&&Math.abs(y-scar)<.29&&Math.abs(x)>1.15)return 'scar';
    return y>.85||d[1]>.5?'back':'side';
  },bodyWeights);
  // Hollow mandible: a stepped rim and floor, never a solid block filling the mouth.
  voxel('Mandible_Voxel_Skin',[-1.6,-1.25,4.25],[1.6,-.5,8.5],cell,(x,y,z)=>{const w=1.45-.14*clamp((z-6)/2);if(Math.abs(x)>w)return false;return y<-.95||Math.abs(x)>w-.28||z>8.05||z<4.6;},()=> 'belly',rigid(jaw));
  const upper=builder(),lower=builder();
  boxTo(upper,[2.42,.12,3.72],[0,-.14,6.35],'mouth');boxTo(upper,[2.52,1.15,.16],[0,-.65,4.3],'mouth');
  boxTo(lower,[2.45,.1,3.45],[0,-.9,6.38],'mouth');boxTo(lower,[1.65,.12,2.5],[0,-.8,6.2],'gum');
  for(const sign of [-1,1]){boxTo(upper,[.2,.18,3.8],[sign*1.3,-.22,6.3],'gum');boxTo(lower,[.18,.18,3.6],[sign*1.28,-.68,6.4],'gum');}
  boxTo(upper,[2.55,.18,.22],[0,-.22,8.1],'gum');boxTo(lower,[2.52,.18,.22],[0,-.68,8.17],'gum');
  addSkin('Upper_Palate_And_Gums',upper.finish(),rigid(skull));addSkin('Lower_Mouth_And_Gums',lower.finish(),rigid(jaw));
  // Triangular teeth are wedges, with two staggered rows on each dental arch.
  function tooth(b,at,w,h,depth,up,side){let tri=[[-w/2,0],[w/2,0],[0,up?h:-h]];if(!up)tri.reverse();const q=new T.Quaternion().setFromEuler(new T.Euler(0,side?Math.PI/2:0,0));const v=(a,z)=>new T.Vector3(a[0],a[1],z).applyQuaternion(q).add(new T.Vector3(...at)).toArray();const f=tri.map(a=>v(a,depth/2)),r=tri.map(a=>v(a,-depth/2));b.face(f,'tooth');b.face([...r].reverse(),'tooth');for(let i=0;i<3;i++)b.face([r[i],r[(i+1)%3],f[(i+1)%3],f[i]],'tooth');}
  const topTeeth=builder(),bottomTeeth=builder();
  for(let row=0;row<2;row++){
    for(const sign of [-1,1])for(let i=0;i<10;i++){const z=4.7+i*.34+row*.12,h=(.34+.11*Math.sin(i*Math.PI/9))*(row?.72:1);tooth(topTeeth,[sign*(1.28-row*.25),-.29,z],.27,h,.13,false,true);tooth(bottomTeeth,[sign*(1.24-row*.24),-.59,z+.05],.25,h*.86,.13,true,true);}
    for(let i=0;i<7;i++){const x=-1.02+i*.34;tooth(topTeeth,[x,-.29,8.08-row*.25],.27,.4*(row?.72:1),.14,false,false);tooth(bottomTeeth,[x,-.59,8.13-row*.25],.25,.33*(row?.72:1),.14,true,false);}
  }
  addSkin('Upper_Teeth_Two_Rows',topTeeth.finish(),rigid(skull));addSkin('Lower_Teeth_Two_Rows',bottomTeeth.finish(),rigid(jaw));
  for(const sign of [-1,1]){const side=sign<0?'L':'R';
    box('Eye_Socket_'+side,[.13,.6,1.1],[sign*1.06,.57,6.62],'black',skull);
    box('Eye_Amber_'+side,[.15,.27,.29],[sign*1.145,.57,6.77],'eye',skull);
    box('Eye_Slit_'+side,[.02,.21,.047],[sign*1.23,.57,6.77],'black',skull);
    box('Brow_Angry_'+side,[.39,.22,1.3],[sign*1.21,.94,6.62],'back',skull,[.12,0,0]);
    box('Nostril_'+side,[.24,.11,.04],[sign*.68,.36,8.495],'black',skull);
    for(let i=0;i<5;i++){const b=(sign<0?gillsL:gillsR)[i];box('Gill_Slit_'+side+'_'+i,[.08,1.4-i*.075,.18],[sign*1.31,.025,gillZ[i]],'black',b);box('Gill_Lip_'+side+'_'+i,[.19,1.33-i*.075,.12],[sign*1.43,.025,gillZ[i]-.16],'side',b);}
  }
  const insidePoly=(a,b,p)=>{let c=false;for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i][1]>b)!==(p[j][1]>b)&&a<(p[j][0]-p[i][0])*(b-p[i][1])/(p[j][1]-p[i][1])+p[i][0])c=!c;return c;};
  function finYZ(name,poly,thick,base,tip,color='back'){const ys=poly.map(p=>p[0]),zs=poly.map(p=>p[1]);return voxel(name,[-thick/2,Math.min(...ys),Math.min(...zs)],[thick/2,Math.max(...ys),Math.max(...zs)],cell,(x,y,z)=>Math.abs(x)<thick/2+.001&&insidePoly(y,z,poly),(x,y,z)=>color,tip?v=>{const p=world.get(base),q=world.get(tip),a=new T.Vector3(...pt(q.map((v,i)=>v-p[i]))),v0=new T.Vector3(...pt(p)),w=smooth((v.clone().sub(v0).dot(a)/a.lengthSq()-.12)/.8);return [[index(base),1-w],[index(tip),w]];}:rigid(base));}
  finYZ('Dorsal_Tall_Voxel',[[1.25,2.5],[1.8,1.7],[3.75,-.15],[3.75,-.55],[1.1,-1.5]],.5,dorsal,null);
  finYZ('Dorsal_Secondary_Voxel',[[.5,-3.25],[1.3,-4.15],[1.3,-4.45],[.35,-4.8]],.25,dorsal2,null);
  finYZ('Anal_Voxel',[[-.45,-3.9],[-1.25,-4.75],[-1.25,-5],[-.3,-4.95]],.25,anal,null,'side');
  finYZ('Tail_Upper_Crescent',[[0,-6.45],[.7,-6.95],[2.0,-7.65],[3.5,-8.75],[3.75,-9.5],[3.25,-9.25],[1.25,-7.9],[-.15,-7]],.5,tail,tailUpper,'side');
  finYZ('Tail_Lower_Crescent',[[.15,-6.5],[-.6,-6.95],[-1.5,-7.5],[-2.25,-8.5],[-2.25,-9],[-1.8,-8.75],[-.8,-7.9],[.2,-7]],.5,tail,tailLower,'back');
  for(const sign of [-1,1]){const side=sign<0?'L':'R',base=sign<0?pecL:pecR,tip=sign<0?pecTipL:pecTipR,poly=[[1.2,3.45],[1.9,2.9],[3.5,-.9],[3.5,-1.25],[2.95,-1.1],[1.15,.85]];
    voxel('Pectoral_'+side+'_Swept_Voxel',[sign<0?-3.5:1,-1.25,-1.5],[sign<0?-1:3.5,-.35,3.5],cell,(x,y,z)=>insidePoly(Math.abs(x),z,poly)&&Math.abs(y-(-.52-.13*Math.abs(x)))<.17,(x,y,z,d)=>d[1]<0?'belly':'side',v=>{const w=smooth((Math.abs(v.x/S)-1.35)/1.9);return [[index(base),1-w],[index(tip),w]];});
    const pelvic=sign<0?pelvicL:pelvicR,pp=[[.55,-2.2],[1,-2.5],[2,-4.0],[1.75,-4.25],[.6,-3.3]];
    voxel('Pelvic_'+side+'_Voxel',[sign<0?-2:.5,-1.25,-4.5],[sign<0?-.5:2,-.5,-2],cell,(x,y,z)=>insidePoly(Math.abs(x),z,pp)&&Math.abs(y+.85+.05*Math.abs(x))<.15,(x,y,z,d)=>d[1]<0?'belly':'side',rigid(pelvic));
  }
  // Bone rest is established before binding; the display pose opens the mandible afterwards.
  jaw.rotation.x=.20;
  addAnimations(k,{root,skull,jaw,spine,tail,tailUpper,tailLower,dorsal,dorsal2,pecL,pecR,pecTipL,pecTipR,pelvicL,pelvicR,anal,gillsL,gillsR});
  k.edges(k.root,{color:'#080d13',thickness:.55,worldThickness:.0012,creaseAngle:58,silhouette:true,creases:true});
  const before=k.quality();const fixed=k.fixTopology({relaxIterations:0});const after=k.quality();
  k.root.userData.smartTopology={before:before.score,after:after.score,grade:after.grade,fix:fixed};
  k.root.userData.assetInfo={title:'MEGALODON — Abyss Sovereign',studMeters:S,forward:'+Z',squareStudPitch:.25,geometry:'Exposed voxel-union surfaces; no internal cube faces',rig:'Hinged jaw, skull, eight spine segments, tail peduncle and lobes, all fins and ten breathing gills',animationCount:k.clips.length};
}
