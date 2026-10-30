export async function build(k) {
  const T=k.THREE,S=k.STUD,pi=Math.PI,tau=2*pi,STUD_DENSITY=4; // 4 square studs per stud = exactly one stud per 0.25-stud voxel cell (grid-aligned)
  const stage=k.group('Megalodon',{rotate:[0,pi,0]}),root=k.bone('Root',{parent:stage});
  const colors={back:'#344b60',side:'#507b9c',scar:'#b5bec9',belly:'#e7e2d7',gum:'#9f3046',mouth:'#190f1a',tooth:'#fff6df',black:'#0b1521',eye:'#ffca3d',eyeCore:'#ff6a00',backLite:'#46617b',sideLite:'#6890b0',sideDark:'#41657f',tip:'#1f3042'},M={};
  for(const [key,col] of Object.entries(colors)){M[key]=await k.studMaterial(col,{style:'kek',normalScale:.7,roughness:.62,metalness:0,brighten:false});M[key].name='SquareStud_'+key;for(const t of [M[key].map,M[key].normalMap])if(t)t.repeat.multiplyScalar(STUD_DENSITY);}
  M.eye.emissive.set('#ffb900');M.eye.emissiveIntensity=2.2;M.eyeCore.emissive.set('#ff5a00');M.eyeCore.emissiveIntensity=2.6;
  const hash=(a,b)=>{let n=Math.imul(a,374761393)+Math.imul(b,668265263)|0;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};
  const point=p=>p.map(v=>v*S),B=(name,parent,at)=>k.bone(name,{parent,at:point(at)});
  const skull=B('Skull',root,[-4.4,0,0]),jaw=B('Jaw_Hinge',skull,[.6,-.45,0]);
  const chain=[skull],locations=[-4.4,-2.9,-1.4,.1,1.6,3.1,4.6,6.1,7.2];
  for(let i=1;i<locations.length;i++)chain.push(B('Spine_'+String(i).padStart(2,'0'),chain[i-1],[locations[i]-locations[i-1],0,0]));
  const bones=[root,...chain,jaw];
  const weightBody=v=>{const x=v.x/S;if(x<=locations[0])return [[1,1]];for(let i=0;i<locations.length-1;i++)if(x<=locations[i+1]){let w=(x-locations[i])/(locations[i+1]-locations[i]);w=w*w*(3-2*w);return [[i+1,1-w],[i+2,w]];}return [[chain.length,1]];};
  // Explicit quads with an orthonormal physical-scale UV basis on every face.
  function builder(){const pos=[],uv=[],idx=[],groups=[];return {quad(a,b,c,d,mat=0){a=point(a);b=point(b);c=point(c);d=point(d);const va=new T.Vector3(...a),vb=new T.Vector3(...b),vc=new T.Vector3(...c),u=vb.clone().sub(va).normalize(),n=vb.clone().sub(va).cross(vc.clone().sub(va)).normalize(),v=n.clone().cross(u),start=pos.length/3;for(const p of [a,b,c,d]){pos.push(...p);const q=new T.Vector3(...p);uv.push(q.dot(u)/S,q.dot(v)/S);}idx.push(start,start+1,start+2,start,start+2,start+3);groups.push([idx.length-6,6,mat]);},finish(){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();for(const a of groups)g.addGroup(...a);g.userData.sourceQuads=idx.length/6;return g;}};}
  function box(name,size,at,mat,parent=root,rotate){const g=k.geometry('box',point(size));k.worldUV(g);return k.mesh(name,g,null,M[mat],{parent,at:point(at),...(rotate?{rotate}:{})});}
  function prism(name,poly,thick,mat,parent,at=[0,0,0]){const shape=new T.Shape(poly.map(p=>new T.Vector2(...p))),g=new T.ExtrudeGeometry(shape,{depth:thick,bevelEnabled:false,curveSegments:1});g.translate(0,0,-thick/2);g.scale(S,S,S);k.worldUV(g);return k.mesh(name,g,null,M[mat],{parent,at:point(at)});}
  const contour=[[1,.5],[1,-.5],[.85,-.5],[.85,-.85],[.5,-.85],[.5,-1],[-.5,-1],[-.5,-.85],[-.85,-.85],[-.85,-.5],[-1,-.5],[-1,.5],[-.85,.5],[-.85,.85],[-.5,.85],[-.5,1],[.5,1],[.5,.85],[.85,.85],[.85,.5]];
  const profile=[[-4.6,1.6,1.92],[-3.5,1.72,1.95],[-2,1.7,1.87],[0,1.52,1.62],[2,1.15,1.23],[4,.75,.79],[5.5,.42,.48],[7.3,.25,.29]];
  function radii(x){for(let i=0;i<profile.length-1;i++)if(x<=profile[i+1][0]){const a=profile[i],b=profile[i+1],w=(x-a[0])/(b[0]-a[0]);return [a[1]*(1-w)+b[1]*w,a[2]*(1-w)+b[2]*w];}return profile.at(-1).slice(1);}
  // The throat meets the mandible instead of exposing a second, open belly ring below it.
  const body=builder(),N=84,ring=(x,j)=>{const [ry,rz]=radii(x),p=contour[j%contour.length],throat=T.MathUtils.smoothstep(x,-4.6,-2.5);return [x,p[0]*ry*(p[0]<0?T.MathUtils.lerp(.82,1.08,throat):1),p[1]*rz];};
  for(let i=0;i<N;i++){const x=-4.6+11.9*i/N,x2=-4.6+11.9*(i+1)/N;for(let j=0;j<contour.length;j++){const a=ring(x,j),b=ring(x2,j),c=ring(x2,j+1),d=ring(x,j+1),cy=(a[1]+c[1])/2;let m=cy<-.63?2:cy>.85?0:1;const scarY=1.2-(x+2)*.85;if(x>-2.4&&x<.4&&Math.abs(cy-scarY)<.25&&Math.abs(a[2])>.8)m=3;
    // Block mosaic: chunky 3-quad cells get a lighter or darker shade, like a hand-built part model.
    if(m<2){const r=hash(Math.floor((x+10)/.42),Math.floor(j/2)+31*m);if(r<.16)m=m?5:4;else if(m===1&&r>.9)m=6;}
    body.quad(a,b,c,d,m);}}
  // End rings sit inside the rigid skull and tail fork.
  k.skin('Body_Continuous_Quad_Skin',body.finish(),[M.back,M.side,M.belly,M.scar,M.backLite,M.sideLite,M.sideDark],bones,weightBody,{parent:stage});
  // Head and jaw: smooth shark shapes voxelized on a 0.25-stud grid (only the outer cube faces are emitted),
  // so the silhouette steps in small even blocks instead of stacked slabs. Skull space, -X = forward.
  const VM=[M.back,M.side,M.belly,M.scar,M.backLite,M.sideLite,M.sideDark,M.mouth,M.gum],VS=.25;
  function voxel(name,inside,[xa,xb,ya,yb,za,zb],matOf,parent,shift=[0,0,0]){
    const s=VS,cells=new Set(),K=(i,j,l)=>i+','+j+','+l,has=(i,j,l)=>cells.has(K(i,j,l)),b=builder(),P=p=>[p[0]+shift[0],p[1]+shift[1],p[2]+shift[2]];
    for(let i=Math.floor(xa/s);i<Math.ceil(xb/s);i++)for(let j=Math.floor(ya/s);j<Math.ceil(yb/s);j++)for(let l=Math.floor(za/s);l<Math.ceil(zb/s);l++)if(inside((i+.5)*s,(j+.5)*s,(l+.5)*s))cells.add(K(i,j,l));
    for(const key of cells){const [i,j,l]=key.split(',').map(Number),x=i*s,y=j*s,z=l*s,x1=x+s,y1=y+s,z1=z+s,c=[x+s/2,y+s/2,z+s/2],F=(n,q)=>b.quad(...q.map(P),matOf(c,n,i,j,l));
      if(!has(i+1,j,l))F([1,0,0],[[x1,y,z],[x1,y1,z],[x1,y1,z1],[x1,y,z1]]);
      if(!has(i-1,j,l))F([-1,0,0],[[x,y,z],[x,y,z1],[x,y1,z1],[x,y1,z]]);
      if(!has(i,j+1,l))F([0,1,0],[[x,y1,z],[x,y1,z1],[x1,y1,z1],[x1,y1,z]]);
      if(!has(i,j-1,l))F([0,-1,0],[[x,y,z],[x1,y,z],[x1,y,z1],[x,y,z1]]);
      if(!has(i,j,l+1))F([0,0,1],[[x,y,z1],[x1,y,z1],[x1,y1,z1],[x,y1,z1]]);
      if(!has(i,j,l-1))F([0,0,-1],[[x,y,z],[x,y1,z],[x1,y1,z],[x1,y,z]]);}
    k.mesh(name,b.finish(),null,VM,{parent});
    const col=(x,f)=>{const i=Math.floor(x/s),out=[];for(const key of cells){const c=key.split(',').map(Number);if(c[0]===i&&f(c))out.push(c);}return out;};
    return {outerZ:(x,y)=>{const j=Math.floor(y/s),c=col(x,c=>c[1]===j&&c[2]>=0);return c.length?Math.max(...c.map(c=>c[2]+1))*s:0;},
      minY:(x,z)=>{const l=Math.floor(Math.abs(z)/s),c=col(x,c=>c[2]===l);return c.length?Math.min(...c.map(c=>c[1]))*s:null;},
      maxY:(x,z)=>{const l=Math.floor(Math.abs(z)/s),c=col(x,c=>c[2]===l);return c.length?Math.max(...c.map(c=>c[1]+1))*s:null;}};}
  const clamp01=v=>Math.min(1,Math.max(0,v)),ym=x=>-.3+(.3-x)*.107; // mouth line: high under the snout, low at the corner
  const tH=x=>clamp01((.45-x)/4.4),W=x=>1.92*Math.max(0,1-tH(x)**2.4)**.55,topY=x=>.32+1.44*Math.max(0,1-tH(x)**2)**.55,botY=x=>ym(x)+Math.max(0,-3.45-x)*1.2;
  const head=voxel('Head_Voxel',(x,y,z)=>{if(x>.45||x<-3.95)return false;const b=botY(x),t=topY(x);if(y<b||y>t)return false;const ny=(y-b)/(t-b);return Math.abs(z)<=W(x)*Math.cbrt(1-ny**3);},
    [-4,.5,-.5,1.9,-2,2],([x,y,z],n,i,j,l)=>{const ny=(y-botY(x))/(topY(x)-botY(x));
      if(n[1]<0)return x>-3.45?(Math.abs(z)>W(x)-.32?8:7):2;
      if(x<-3.45&&ny<.3)return 2;
      const base=n[1]>0||ny>.72?0:1,r=hash(i*3+j*7,l*5+base);return r<.16?(base?5:4):base&&r>.9?6:base;},skull);
  const hz=(x,y)=>head.outerZ(x,y);
  // Inset mandible: shorter than the nose, with a raised rear heel covering the hinge.
  const JW=x=>Math.max(0,W(x)-.24),jt=x=>ym(x)-.28+.28*T.MathUtils.smoothstep(x,-1,.35),JD=x=>.72-.34*clamp01((.3-x)/3.8);
  const jawV=voxel('Jaw_Voxel',(x,y,z)=>{if(x>.5||x<-3.45)return false;const t=jt(x),d=JD(x);if(y>t||y<t-d)return false;const ny=(t-y)/d;return Math.abs(z)<=JW(x)*(ny<.4?1:1-.4*((ny-.4)/.6)**2);},
    [-3.5,.5,-1.5,.3,-2,2],([x,y,z],n)=>n[1]>0?(Math.abs(z)>JW(x)-.3?8:7):2,jaw,[-.6,.45,0]);
  box('Throat_Shadow',[.4,1.1,2.95],[.2,-.68,0],'mouth',skull);
  box('Tongue',[2.2,.08,1.3],[-1.6-.6,jt(-1.6)+.45-.04,0],'gum',jaw);
  for(const sign of [-1,1]){const side=sign<0?'R':'L',ew=hz(-1.95,.62);
    // Small sunken eye under a heavy brow: a slanted glow slit, not a framed window.
    box('Eye_Recess_'+side,[.5,.3,.06],[-1.95,.6,sign*(ew-.01)],'black',skull);
    box('Eye_Glow_'+side,[.3,.18,.06],[-1.97,.6,sign*(ew+.02)],'eye',skull,[0,0,-.12]);
    box('Eye_Core_'+side,[.12,.12,.03],[-1.99,.6,sign*(ew+.05)],'eyeCore',skull);
    box('Eye_Pupil_'+side,[.05,.16,.02],[-1.99,.6,sign*(ew+.065)],'black',skull);
    box('Angry_Brow_'+side,[.9,.18,.2],[-1.92,.8,sign*(hz(-1.92,.8)+.02)],'back',skull,[0,0,-.22]);
    box('Nostril_'+side,[.2,.12,.04],[-3.5,.55,sign*(hz(-3.5,.55)+.01)],'black',skull);
    for(let j=0;j<5;j++){const x=-.15+j*.38;box('Gill_'+side+'_'+(j+1),[.14,1.15-j*.055,.075],[x,.02,sign*(1.94-j*.015)],'black',skull,[0,0,-.08]);box('Gill_Lip_'+side+'_'+(j+1),[.1,1.12-j*.055,.12],[x+.13,.03,sign*(1.96-j*.015)],'side',skull,[0,0,-.08]);}
  }
  function tooth(name,x,y,z,h,w,parent,up,front=false){const poly=up?[[-w/2,0],[w/2,0],[-.18*w,h]]:[[-w/2,0],[-.18*w,-h],[w/2,0]],m=prism(name,poly,.14,'tooth',parent,[x,y,z]);if(front)m.rotation.y=pi/2;}
  // Big triangular front teeth shrinking toward the mouth corner, rooted in the gum band of the voxel head/jaw.
  const toothH=(x,seed)=>(.16+.17*clamp01(-x/3.2))*(.94+.12*hash(Math.round(x*100),seed));
  const upY=(x,z)=>(head.minY(x,z)??ym(x))+.02,loY=(x,z)=>(jawV.maxY(x,z)??jt(x))-.02+.45;
  // One clean row per jaw: side teeth evenly spaced, front arc kept clear of the side rows so nothing crosses.
  for(let row=0;row<1;row++){const s=1;
    for(const sign of [-1,1])for(let i=0;i<8;i++){const x=-2.95+i*.36,xl=x+.18,zu=W(x)-.2,zl=JW(xl)-.3;
      tooth('Tooth_Upper_'+row+'_'+sign+'_'+i,x,upY(x,zu),sign*zu,toothH(x,row*7+sign)*s,.27,skull,false);
      tooth('Tooth_Lower_'+row+'_'+sign+'_'+i,xl-.6,loY(xl,zl),sign*zl,toothH(xl,row*7+sign+3)*s*.85,.25,jaw,true);}
    const xu=-3.28,xf=-3.08,fu=W(xu)-.55,fl=JW(xf)-.4;
    for(let i=0;i<4;i++){const zu=-fu+i*2*fu/3,zl=-fl+i*2*fl/3;tooth('Tooth_FrontUpper_'+row+'_'+i,xu,upY(xu,zu),zu,(.32+.025*hash(i,row))*s,.25,skull,false,true);tooth('Tooth_FrontLower_'+row+'_'+i,xf-.6,loY(xf,zl),zl,(.27+.02*hash(i,row+9))*s,.23,jaw,true,true);}
  }
  // Visible boundary of a voxel union; no hidden internal cube faces.
  function inPoly(x,y,p){let c=false;for(let i=0,j=p.length-1;i<p.length;j=i++)if(((p[i][1]>y)!==(p[j][1]>y))&&x<(p[j][0]-p[i][0])*(y-p[i][1])/(p[j][1]-p[i][1])+p[i][0])c=!c;return c;}
  function finGeo(poly,thick,plane='xy',step=.25){const cells=new Set(),b=builder(),minX=Math.floor(Math.min(...poly.map(p=>p[0]))/step),maxX=Math.ceil(Math.max(...poly.map(p=>p[0]))/step),minY=Math.floor(Math.min(...poly.map(p=>p[1]))/step),maxY=Math.ceil(Math.max(...poly.map(p=>p[1]))/step);for(let x=minX;x<maxX;x++)for(let y=minY;y<maxY;y++)if(inPoly((x+.5)*step,(y+.5)*step,poly))cells.add(x+','+y);const cv=(x,y,z)=>plane==='xz'?[x,z,-y]:[x,y,z];for(const key of cells){const [i,j]=key.split(',').map(Number),x=i*step,y=j*step,x1=x+step,y1=y+step,h=thick/2,e=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>!cells.has((i+dx)+','+(j+dy)))?1:0,q=(...v)=>b.quad(...v,e);q(cv(x,y,h),cv(x1,y,h),cv(x1,y1,h),cv(x,y1,h));q(cv(x,y1,-h),cv(x1,y1,-h),cv(x1,y,-h),cv(x,y,-h));if(!cells.has((i-1)+','+j))q(cv(x,y,-h),cv(x,y,h),cv(x,y1,h),cv(x,y1,-h));if(!cells.has((i+1)+','+j))q(cv(x1,y1,-h),cv(x1,y1,h),cv(x1,y,h),cv(x1,y,-h));if(!cells.has(i+','+(j-1)))q(cv(x1,y,-h),cv(x1,y,h),cv(x,y,h),cv(x,y,-h));if(!cells.has(i+','+(j+1)))q(cv(x,y1,-h),cv(x,y1,h),cv(x1,y1,h),cv(x1,y1,-h));}return b.finish();}
  const fins=[];
  function fin(name,parent,at,poly,plane,thick,tip,mat='back',step=.25){const base=B(name,parent,at),end=B(name+'_Tip',base,tip);stage.updateMatrixWorld(true);const m=stage.matrixWorld.clone().invert().multiply(base.matrixWorld),g=finGeo(poly,thick,plane,step);g.applyMatrix4(m);const inv=m.clone().invert(),axis=new T.Vector3(...point(tip)),len=axis.length();axis.normalize();k.skin(name+'_VoxelSkin',g,[M[mat],M.tip],[base,end],v=>{const p=v.clone().applyMatrix4(inv),w=T.MathUtils.smoothstep(p.dot(axis)/len,.15,.95);return [[0,1-w],[1,w]];},{parent:stage});fins.push({base,end,name});return base;}
  fin('Dorsal',chain[2],[-.25,1.48,0],[[-1.9,0],[1.7,0],[1.2,.55],[.95,2.9],[.45,2.75],[-.7,1.15]],'xy',.38,[.6,1.9,0]);
  fin('Dorsal_Secondary',chain[5],[.05,.72,0],[[-.65,0],[.7,0],[.45,.9],[.05,.72]],'xy',.25,[.3,.6,0]);
  for(const sign of [-1,1]){const side=sign>0?'L':'R';fin('Pectoral_'+side,chain[1],[-.05,-.66,sign*1.4],[[-1,0],[.8,-sign*.2],[3.5,-sign*2.6],[3.05,-sign*3],[1.6,-sign*2],[.1,-sign*1.35]],'xz',.3,[1.6,-.05,sign*1.6],'side');fin('Pelvic_'+side,chain[4],[.35,-.87,sign*.65],[[-.5,0],[.6,0],[1.4,-sign*.8],[.8,-sign*1.1]],'xz',.23,[.65,0,sign*.65],'side');}
  fin('Anal',chain[5],[.6,-.64,0],[[-.5,0],[.65,0],[1,-.65],[.4,-.8]],'xy',.22,[.55,-.45,0]);
  const tail=B('Tail_Fork',chain.at(-1),[.05,0,0]);
  fin('Tail_Upper',tail,[0,0,0],[[-.2,-.15],[.7,-.2],[2.4,2.2],[3.15,3.95],[2.45,3.8],[1.3,2.3],[.35,1.05]],'xy',.36,[1.6,2.05,0],'side');
  fin('Tail_Lower',tail,[0,0,0],[[-.15,.1],[.4,-.8],[1.7,-1.75],[2.85,-2.45],[2.4,-1.55],[.7,.2]],'xy',.32,[1.6,-1.4,0],'side');
  for(let i=2;i<10;i++){const x=-3.7+i*.8,[ry,rz]=radii(x),parent=chain[Math.min(chain.length-1,Math.max(0,Math.round((x+4.4)/1.5)))],localX=x-locations[chain.indexOf(parent)];box('Back_Plate_'+i,[.75,.12,Math.max(.5,rz)],[localX,ry+.025,0],'back',parent);}
  // Battle scars: light stepped slashes on the left side of the head and the crown.
  [[-2.65,.72,.75,.5],[-1.05,1.08,.95,-.3],[-.2,.55,.6,.4]].forEach(([x,y,len,rot],i)=>box('Head_Scar_'+i,[len,.08,.04],[x,y,hz(x,y)+.01],'scar',skull,[0,0,rot]));
  box('Crown_Scar',[.12,.04,.9],[-1.2,(head.maxY(-1.2,.25)??1.6)+.02,.25],'scar',skull,[0,.35,0]);
  // Caudal keels: the flat lateral ridges at the tail base of lamnid sharks.
  for(const sign of [-1,1]){const side=sign<0?'R':'L';for(const [bi,lx,len] of [[7,.15,1.3],[8,-.1,.9]]){const gx=locations[bi]+lx,rz=radii(gx)[1];box('Caudal_Keel_'+side+'_'+bi,[len,.16,.18],[lx,0,sign*(rz+.06)],'back',chain[bi]);}}
  jaw.rotation.z=.05;
  // ---- Animation: pose parameters -> traveling spine wave, head isolation, fin follow-through ----
  // Root euler = [roll, yaw, pitch(+ nose down)]; positions in studs. Every loop and every transition starts at
  // phase 0 of its state, so "X Start" ends exactly on frame 0 of loop X and "X Stop" starts there.
  const ease5=x=>{x=Math.min(1,Math.max(0,x));return x*x*x*(x*(6*x-15)+10);},bump=(u,a,b)=>u<=a||u>=b?0:Math.sin(pi*(u-a)/(b-a))**2;
  const key=(u,pts)=>{const n=pts.length;if(u<=pts[0][0])return pts[0][1];if(u>=pts[n-1][0])return pts[n-1][1];let i=0;while(u>pts[i+1][0])i++;const [a,va]=pts[i],[b,vb]=pts[i+1],h=b-a,s=(u-a)/h,m=j=>j<=0||j>=n-1?0:(pts[j+1][1]-pts[j-1][1])/(pts[j+1][0]-pts[j-1][0]),m0=m(i)*h,m1=m(i+1)*h,s2=s*s,s3=s2*s;return (2*s3-3*s2+1)*va+(s3-2*s2+s)*m0+(-2*s3+3*s2)*vb+(s3-s2)*m1;};
  const sk=(m,pts)=>pts.map(([u,v])=>[u,v*m]);
  const Z={amp:0,freq:0,bend:0,arch:0,roll:0,pitch:0,yaw:0,x:0,y:0,z:0,jaw:.19,flare:0,sweep:0,headYaw:0,headPitch:0,tailKick:0,shake:0,shakeHz:8};
  const st=o=>({...Z,...o}),mirror=s=>({...s,bend:-s.bend,roll:-s.roll,headYaw:-s.headYaw,yaw:-s.yaw,z:-s.z,tailKick:-s.tailKick}),mix=(a,b,w)=>{const o={};for(const n in Z)o[n]=a[n]+(b[n]-a[n])*w;return o;};
  const idle=st({amp:.045,freq:.4,jaw:.21,flare:.12}),cruise=st({amp:.07,freq:.62,jaw:.22,flare:.05}),fast=st({amp:.115,freq:1.5,jaw:.3,flare:-.14,sweep:.16,pitch:.04,arch:.004});
  const sprint=st({amp:.14,freq:2.4,jaw:.5,flare:-.22,sweep:.28,pitch:.06,headPitch:.04,shake:.008,shakeHz:11}),hover=st({amp:.024,freq:.3,jaw:.24,flare:.42,sweep:-.22,pitch:-.06});
  const turnL=st({amp:.078,freq:.7,bend:.085,roll:.22,headYaw:.1,flare:.05,jaw:.22}),bankL=st({amp:.07,freq:.65,bend:.035,roll:.45,headYaw:.04,flare:.1,jaw:.22});
  const dive=st({amp:.085,freq:.85,pitch:.32,arch:-.012,flare:-.08,sweep:.1,jaw:.24}),ascend=st({amp:.095,freq:.85,pitch:-.3,arch:.012,flare:.16,jaw:.22});
  const stalk=st({amp:.05,freq:.5,bend:.045,roll:.12,headYaw:.06,jaw:.2,flare:.08}),threat=st({amp:.1,freq:.95,arch:.03,headPitch:-.12,flare:-.55,sweep:-.1,jaw:.48});
  const frenzy=st({amp:.13,freq:1.25,jaw:.4,flare:.1,shake:.05,shakeHz:5}),rage=st({amp:.17,freq:2,jaw:.7,flare:-.1,shake:.07,shakeHz:4}),injured=st({amp:.06,freq:.55,roll:.28,pitch:.08,jaw:.32,flare:.3,bend:.02});
  const dead=st({roll:pi,y:-1.3,jaw:.62,flare:.55,pitch:.12,arch:-.01,sweep:-.1});
  const defs=[],L=(name,d,s,fx,cycles)=>defs.push({name:name+' [Loop]',d,loop:true,cycles:cycles??Math.round(s.freq*d),P:(u,t)=>{const p={...s};fx&&fx(p,u,t);return p;}});
  const X=(name,d,a,b,fx,curve=ease5)=>defs.push({name,d,loop:false,P:(u,t)=>{const p=mix(a,b,curve(u));fx&&fx(p,u,t);return p;}});
  const A=(name,d,fx,base=cruise)=>defs.push({name,d,loop:false,P:(u,t)=>{const p={...base};fx(p,u,t);return p;}});
  const sn=(n,u)=>Math.sin(n*tau*u),cs=(n,u)=>(1-Math.cos(n*tau*u))/2;
  // Loops (seamless: whole wave cycles, extras are whole-period sines that vanish at frame 0).
  L('Idle Swim',5,idle,(p,u)=>{p.y+=.07*sn(1,u);p.yaw+=.035*sn(1,u);p.roll+=.025*sn(1,u);p.jaw+=.03*cs(2,u);p.flare+=.05*sn(1,u);p.headYaw+=.025*sn(2,u);});
  L('Hover Idle',4,hover,(p,u)=>{p.y+=.09*sn(1,u);p.roll+=.035*sn(1,u);p.pitch+=.03*sn(2,u);p.flare+=.07*sn(2,u);p.jaw+=.04*cs(1,u);p.headYaw+=.03*sn(1,u);},1);
  L('Cruise',3.2,cruise,(p,u)=>{p.y+=.04*sn(1,u);p.roll+=.02*sn(1,u);});
  L('Fast Swim',2,fast,(p,u)=>{p.y+=.025*sn(2,u);p.pitch+=.015*sn(3,u);});
  L('Sprint Charge',1.25,sprint,(p,u)=>{p.y+=.02*sn(3,u);p.jaw+=.06*cs(3,u);});
  for(const [side,m] of [['Left',1],['Right',-1]]){const T=m>0?turnL:mirror(turnL),Bk=m>0?bankL:mirror(bankL);
    L('Turn '+side,3,T,(p,u)=>{p.headYaw+=m*.03*sn(1,u);p.y+=.03*sn(1,u);});
    L('Bank '+side,3.2,Bk,(p,u)=>{p.roll+=m*.04*sn(1,u);p.y+=.03*sn(1,u);});}
  L('Dive',2.4,dive,(p,u)=>{p.roll+=.03*sn(1,u);});
  L('Ascend',2.4,ascend,(p,u)=>{p.roll+=.03*sn(1,u);});
  L('Stalk Circle',6,stalk,(p,u)=>{p.headYaw+=.06*sn(1,u);p.roll+=.05*sn(1,u);p.jaw+=.06*cs(1,u);p.y+=.05*sn(2,u);});
  L('Threat Display',3.2,threat,(p,u)=>{p.jaw+=.3*cs(2,u);p.headYaw+=.08*sn(2,u);p.roll+=.06*sn(2,u);p.headPitch-=.05*cs(2,u);});
  L('Feeding Chew',1.6,frenzy,(p,u)=>{p.jaw+=.45*cs(2,u);p.headPitch+=.06*sn(2,u);p.roll+=.08*sn(1,u);});
  L('Enraged Thrash',1.5,rage,(p,u)=>{p.roll+=.12*sn(1,u);p.jaw+=.25*cs(3,u);p.headPitch-=.06*cs(3,u);});
  L('Injured Swim',3.6,injured,(p,u)=>{p.amp+=.025*sn(1,u);p.roll+=.08*sn(1,u);p.y-=.06*cs(1,u);p.headYaw+=.04*sn(2,u);p.jaw+=.06*sn(1,u);});
  L('Dead Float',5,dead,(p,u)=>{p.y+=.08*sn(1,u);p.yaw+=.05*sn(1,u);p.roll+=.04*sn(1,u);p.jaw+=.03*sn(1,u);},0);
  // Transitions: start on frame 0 of loop A, end on frame 0 of loop B.
  X('Swim Start',1.6,idle,cruise,(p,u)=>{p.amp+=.03*bump(u,.1,.7);p.tailKick+=.12*Math.sin(tau*u)*bump(u,0,1);p.flare-=.08*bump(u,.1,.8);});
  X('Swim Stop',2.2,cruise,idle,(p,u)=>{p.flare+=.28*bump(u,.1,.75);p.pitch-=.07*bump(u,.1,.8);p.x+=.25*bump(u,.1,.8);p.sweep-=.15*bump(u,.1,.75);});
  X('Accelerate',1.2,cruise,fast,(p,u)=>{p.amp+=.04*bump(u,.05,.6);p.x-=.35*bump(u,.1,.9);p.headPitch+=.05*bump(u,.1,.6);});
  X('Decelerate',1.6,fast,cruise,(p,u)=>{p.flare+=.35*bump(u,.05,.7);p.pitch-=.09*bump(u,.05,.75);p.x+=.35*bump(u,.05,.85);p.jaw+=.08*bump(u,.1,.7);});
  X('Sprint Start',1,cruise,sprint,(p,u)=>{p.x-=.5*bump(u,.05,.95);p.amp+=.05*bump(u,0,.5);p.headPitch+=.06*bump(u,0,.5);});
  X('Sprint Stop',1.8,sprint,cruise,(p,u)=>{p.flare+=.5*bump(u,.05,.7);p.pitch-=.14*bump(u,.05,.7);p.x+=.6*bump(u,.05,.85);p.sweep-=.25*bump(u,.05,.7);p.jaw+=.1*bump(u,.1,.6);});
  for(const [side,m] of [['Left',1],['Right',-1]]){const T=m>0?turnL:mirror(turnL);
    X('Turn Start '+side,1.1,cruise,T,(p,u)=>{p.headYaw+=m*.12*bump(u,0,.6);p.tailKick-=m*.14*bump(u,.3,.95);p.roll+=m*.06*bump(u,.3,1);},u=>ease5(u*1.15));
    X('Turn Stop '+side,1.3,T,cruise,(p,u)=>{p.headYaw-=m*.06*bump(u,0,.6);p.tailKick+=m*.16*bump(u,.15,.8);p.roll-=m*.05*bump(u,.3,.9);});}
  X('Brake - Hover Start',2,cruise,hover,(p,u)=>{p.flare+=.3*bump(u,.05,.6);p.pitch-=.14*bump(u,.05,.7);p.x+=.45*bump(u,.05,.9);p.sweep-=.2*bump(u,.05,.6);p.jaw+=.08*bump(u,.1,.6);});
  X('Hover End',1.5,hover,cruise,(p,u)=>{p.tailKick+=.15*Math.sin(tau*u)*bump(u,0,1);p.x-=.3*bump(u,.1,.9);p.amp+=.03*bump(u,.1,.6);});
  X('Dive Start',1.3,cruise,dive,(p,u)=>{p.headPitch+=.08*bump(u,0,.6);p.pitch+=.06*bump(u,.2,.9);});
  X('Dive End',1.4,dive,cruise,(p,u)=>{p.headPitch-=.08*bump(u,0,.6);p.flare+=.15*bump(u,.1,.7);});
  X('Ascend Start',1.3,cruise,ascend,(p,u)=>{p.headPitch-=.08*bump(u,0,.6);p.amp+=.03*bump(u,0,.7);});
  X('Ascend End',1.4,ascend,cruise,(p,u)=>{p.headPitch+=.06*bump(u,0,.6);p.pitch+=.05*bump(u,.3,.9);});
  // Actions: anticipation -> strike -> follow-through; start and end on Cruise frame 0.
  A('Attack Bite',1.4,(p,u)=>{p.jaw=key(u,[[0,.22],[.2,.62],[.32,1.08],[.4,.06],[.48,.1],[.62,.34],[1,.22]]);p.x+=key(u,[[0,0],[.22,.35],[.4,-1.1],[.55,-.9],[1,0]]);p.headPitch+=key(u,[[0,0],[.25,-.14],[.4,.1],[.55,.04],[1,0]]);p.pitch+=key(u,[[0,0],[.25,-.05],[.42,.06],[1,0]]);p.flare+=key(u,[[0,0],[.25,.25],[.4,-.15],[1,0]]);p.amp+=.05*bump(u,.15,.45);p.shake+=.07*bump(u,.4,.7);p.shakeHz=7;});
  A('Lunge',1.9,(p,u)=>{p.jaw=key(u,[[0,.22],[.2,.5],[.4,1.15],[.5,.05],[.6,.1],[1,.22]]);p.x+=key(u,[[0,0],[.18,.6],[.45,-2.6],[.6,-2.5],[1,0]]);p.headPitch+=key(u,[[0,0],[.2,-.18],[.45,.12],[.6,.05],[1,0]]);p.pitch+=key(u,[[0,0],[.2,-.08],[.45,.08],[1,0]]);p.flare+=key(u,[[0,0],[.2,.3],[.45,-.3],[1,0]]);p.amp+=.09*bump(u,.18,.5);p.freq+=1.6*bump(u,.15,.5);});
  A('Double Bite',2.2,(p,u)=>{p.jaw=key(u,[[0,.22],[.12,.8],[.2,1],[.27,.06],[.36,.2],[.46,.95],[.53,1.05],[.6,.04],[.7,.12],[1,.22]]);p.x+=key(u,[[0,0],[.12,.25],[.27,-.8],[.38,-.6],[.6,-1.2],[.75,-.9],[1,0]]);p.headYaw+=key(u,[[0,0],[.2,.06],[.3,.12],[.5,-.08],[.6,-.14],[.8,0],[1,0]]);p.headPitch+=key(u,[[0,0],[.15,-.12],[.27,.08],[.45,-.12],[.6,.08],[1,0]]);p.shake+=.06*bump(u,.6,.8);p.amp+=.04*bump(u,.1,.7);});
  A('Grab & Shake',2.6,(p,u,t)=>{const h=bump(u,.2,.85);p.jaw=key(u,[[0,.22],[.12,1],[.2,.03],[.85,.04],[.93,.6],[1,.22]]);p.shake+=.22*h;p.shakeHz=3.2;p.amp+=.06*h;p.freq+=1.4*h;p.roll+=.18*Math.sin(tau*3.2*t-1)*h;p.x+=key(u,[[0,0],[.1,.2],[.2,-.6],[.85,-.4],[1,0]]);});
  A('Roar - Jaw Open',3,(p,u)=>{const h=bump(u,.2,.9);p.jaw=key(u,[[0,.22],[.12,.1],[.25,.6],[.35,1.3],[.72,1.25],[.85,.4],[1,.22]]);p.headPitch+=key(u,[[0,0],[.15,.08],[.35,-.26],[.72,-.22],[.88,.03],[1,0]]);p.arch+=.025*bump(u,.25,.85);p.flare+=.5*h;p.sweep-=.15*h;p.shake+=.05*bump(u,.35,.75);p.shakeHz=9;p.amp*=1-.6*h;p.y+=.15*h;p.pitch-=.08*bump(u,.2,.85);});
  A('Taunt - Jaw Clack',2.2,(p,u)=>{p.jaw=key(u,[[0,.22],[.1,.75],[.18,.05],[.3,.7],[.38,.05],[.5,.8],[.58,.04],[.75,.3],[1,.22]]);p.headYaw+=key(u,[[0,0],[.18,.12],[.38,-.12],[.58,.1],[.8,0],[1,0]]);p.headPitch+=key(u,[[0,0],[.1,-.1],[.18,.05],[.3,-.1],[.38,.05],[.5,-.12],[.58,.05],[1,0]]);p.roll+=.08*Math.sin(2*tau*u)*bump(u,0,1);p.amp*=1-.5*bump(u,.05,.9);});
  A('Tail Slap',1.6,(p,u)=>{p.bend+=key(u,[[0,0],[.28,.13],[.45,-.17],[.6,-.12],[1,0]]);p.tailKick+=key(u,[[0,0],[.28,.35],[.43,-.85],[.55,-.4],[.75,.1],[1,0]]);p.yaw+=key(u,[[0,0],[.28,-.4],[.45,.5],[.65,.3],[1,0]]);p.roll+=key(u,[[0,0],[.3,.15],[.45,-.25],[1,0]]);p.headYaw+=key(u,[[0,0],[.28,-.08],[.45,.1],[1,0]]);p.amp*=1-.7*bump(u,.1,.8);});
  A('Ram Charge',1.8,(p,u)=>{p.x+=key(u,[[0,0],[.2,.7],[.45,-2.8],[.52,-2.6],[.7,-2.2],[1,0]]);p.headPitch+=key(u,[[0,0],[.2,-.1],[.42,.2],[.5,-.15],[.62,.05],[1,0]]);p.shake+=.1*bump(u,.45,.62);p.shakeHz=10;p.amp+=.08*bump(u,.15,.45);p.freq+=1.8*bump(u,.15,.45);p.jaw=key(u,[[0,.22],[.4,.1],[.5,.5],[.7,.3],[1,.22]]);p.flare+=key(u,[[0,0],[.2,.2],[.42,-.3],[.55,.35],[1,0]]);});
  A('Acceleration Burst',1.6,(p,u)=>{p.freq+=2*bump(u,.05,.7);p.amp+=.08*bump(u,.05,.7);p.x+=key(u,[[0,0],[.15,.2],[.55,-2],[1,0]]);p.flare-=.25*bump(u,.05,.8);p.headPitch+=.05*bump(u,.05,.6);p.jaw+=.2*bump(u,.1,.7);});
  for(const [side,m] of [['Left',1],['Right',-1]]){
    A('Snap Turn '+side,1.5,(p,u)=>{p.bend+=key(u,sk(m,[[0,0],[.25,.16],[.5,.1],[1,0]]));p.headYaw+=key(u,sk(m,[[0,0],[.15,.25],[.4,.1],[1,0]]));p.yaw+=key(u,sk(m,[[0,0],[.3,.7],[.55,.55],[1,0]]));p.roll+=key(u,sk(m,[[0,0],[.25,.35],[.6,.1],[1,0]]));p.tailKick+=key(u,sk(m,[[0,0],[.2,.3],[.38,-.6],[.55,.2],[1,0]]));p.amp+=.05*bump(u,.2,.7);});
    A('Hit Reaction '+side,.9,(p,u)=>{p.z+=key(u,sk(m,[[0,0],[.12,.6],[.4,.35],[1,0]]));p.roll+=key(u,sk(m,[[0,0],[.12,-.35],[.35,.1],[.6,-.05],[1,0]]));p.bend+=key(u,sk(m,[[0,0],[.12,.1],[.35,-.04],[1,0]]));p.headYaw+=key(u,sk(m,[[0,0],[.1,.25],[.35,-.08],[1,0]]));p.jaw+=.4*bump(u,.02,.5);p.shake+=.08*bump(u,.05,.45);p.shakeHz=12;p.amp*=1-.6*bump(u,0,.9);});}
  A('Hit Reaction',.9,(p,u)=>{p.x+=key(u,[[0,0],[.12,.7],[.4,.45],[1,0]]);p.headPitch+=key(u,[[0,0],[.1,-.25],[.35,.05],[1,0]]);p.jaw=key(u,[[0,.22],[.1,.75],[.4,.3],[1,.22]]);p.shake+=.1*bump(u,.05,.5);p.shakeHz=12;p.flare+=.35*bump(u,0,.6);p.pitch-=.08*bump(u,0,.6);p.amp*=1-.6*bump(u,0,.9);});
  A('Heavy Stagger',1.9,(p,u)=>{p.x+=key(u,[[0,0],[.1,1.4],[.4,1],[1,0]]);p.roll+=.4*Math.sin(3*tau*u)*(1-u)**2*Math.min(1,u*8);p.headYaw+=.12*Math.sin(2*tau*u)*(1-u);p.headPitch-=.25*bump(u,0,.4);p.jaw+=.55*bump(u,0,.6);p.flare+=.5*bump(u,0,.7);p.pitch-=.15*bump(u,0,.6);p.amp*=1-.7*bump(u,0,.8);p.y-=.3*bump(u,0,.8);});
  A('Swallow - Gulp',1.6,(p,u)=>{p.jaw=key(u,[[0,.22],[.25,.85],[.42,.03],[.7,.08],[1,.22]]);p.headPitch+=key(u,[[0,0],[.25,-.16],[.45,.08],[.62,-.06],[1,0]]);p.arch+=.02*bump(u,.4,.95)*Math.sin(2*tau*(u-.4));p.y+=.1*bump(u,.1,.9);});
  A('Spawn - Emerge',3.4,(p,u)=>{p.y+=key(u,[[0,-4.5],[.55,.6],[.72,-.15],[.85,.05],[1,0]]);p.pitch+=key(u,[[0,-.75],[.45,-.55],[.65,.15],[.8,-.05],[1,0]]);p.amp+=.06*(1-ease5(u/.7));p.freq+=.8*(1-ease5(u/.7));p.jaw=key(u,[[0,.15],[.55,.3],[.65,1.1],[.72,.05],[.82,.3],[1,.22]]);p.flare+=key(u,[[0,-.25],[.5,-.15],[.65,.4],[.85,.05],[1,0]]);p.tailKick+=key(u,[[0,0],[.5,0],[.58,.4],[.66,-.3],[.8,0],[1,0]]);p.roll+=key(u,[[0,.3],[.5,-.1],[1,0]]);p.headPitch+=key(u,[[0,-.1],[.6,-.15],[.68,.08],[1,0]]);});
  A('Breach Jump',3.6,(p,u)=>{const air=bump(u,.3,.8);p.y+=key(u,[[0,0],[.18,-1.2],[.42,5.5],[.52,6.2],[.62,5.2],[.8,-1.3],[.92,-.2],[1,0]]);p.pitch+=key(u,[[0,0],[.18,.25],[.32,-1.15],[.48,-.5],[.6,.4],[.72,.9],[.85,.2],[1,0]]);p.roll+=key(u,[[0,0],[.35,0],[.55,.5],[.75,.9],[.88,.2],[1,0]]);p.x+=key(u,[[0,0],[.42,-1.5],[.62,-3],[.85,-2],[1,0]]);p.amp+=.09*bump(u,0,.35)-.04*air;p.freq+=1.8*bump(u,0,.35);p.jaw=key(u,[[0,.22],[.35,.4],[.48,1.15],[.62,1],[.7,.25],[1,.22]]);p.flare+=.5*bump(u,.38,.75);p.arch+=-.02*bump(u,.3,.5)+.02*bump(u,.6,.8);});
  defs.push({name:'Death Roll',d:4.6,loop:false,P:(u,t)=>{const p=mix(cruise,dead,ease5((u-.3)/.55)),h=bump(u,0,.4);p.amp+=.1*h;p.freq+=1.4*h;p.jaw+=.6*bump(u,.05,.4);p.shake+=.08*bump(u,0,.35);p.shakeHz=6;p.headPitch-=.2*bump(u,.05,.35);p.roll+=.2*Math.sin(2.5*tau*(u-.8))*bump(u,.75,1);p.y-=.25*bump(u,.6,.95);return p;}});
  function phaseFn(def){if(def.loop)return t=>tau*def.cycles*t/def.d;const n=480,cum=[0];for(let i=1;i<=n;i++){const u=(i-.5)/n;cum.push(cum[i-1]+def.P(u,u*def.d).freq*def.d/n);}const total=cum[n],sc=total>1e-6?Math.max(1,Math.round(total))/total:0;return t=>{const f=Math.min(n,Math.max(0,t/def.d*n)),i=Math.floor(f),a=cum[i],b=cum[Math.min(n,i+1)];return tau*sc*(a+(b-a)*(f-i));};}
  function pose(p,ph,t){const R={},w=(i,o=0)=>Math.sin(ph-i*.62-o),n=chain.length-1,sh=p.shake*Math.sin(tau*p.shakeHz*t),drive=p.amp*9;
    for(let i=0;i<=n;i++){const g=.1+.9*(i/n)**1.25;let y=p.amp*g*w(i)+p.bend*(i?1:.35),z=i?p.arch:0;if(i===0){y+=p.headYaw+sh;z+=p.headPitch;}if(i===1){y-=.75*(p.headYaw+sh);z-=.75*p.headPitch;}R[chain[i].name]=[0,y,z];}
    R[root.name]=[p.roll,p.yaw-.28*p.amp*Math.sin(ph+.35),p.pitch];R[jaw.name]=[0,0,Math.max(0,(p.jaw-.15)*1.12)]/* idle ~.07 rad shows the teeth, <=.15 = fully shut */;R[tail.name]=[0,p.amp*1.2*w(9.2,.3)+p.tailKick,0];
    for(const f of fins){const side=f.name.endsWith('_R')?-1:1,nm=f.name;let b,e;
      if(nm.startsWith('Pectoral')){b=[side*(p.flare+.03*drive*w(1.5,.8))+p.bend*1.4,side*p.sweep,.04*drive*w(1.5,1.4)];e=[side*(.5*p.flare+.05*drive*w(1.5,2))+p.bend*.6,side*.4*p.sweep,.05*drive*w(1.5,2.2)];}
      else if(nm.startsWith('Pelvic')){b=[side*.4*p.flare,side*.4*p.sweep+.04*drive*w(4.5,1),0];e=[0,.06*drive*w(4.5,1.8),0];}
      else if(nm.startsWith('Tail')){const c=nm.includes('Upper')?1:-1;b=[0,.6*p.tailKick+.09*drive*w(9.5,1.2),c*.015*drive*w(9.5,1.6)];e=[0,.35*p.tailKick+.14*drive*w(9.5,2),0];}
      else{const at=nm==='Dorsal'?2:5;b=[-.3*p.bend,.05*drive*w(at,1.2),0];e=[-.2*p.bend,.08*drive*w(at,2),0];}
      R[f.base.name]=b;R[f.end.name]=e;}
    return {R,pos:point([p.x,p.y,p.z])};}
  const animated=[root,...chain,jaw,tail,...fins.flatMap(f=>[f.base,f.end])];
  for(const def of defs){const ph=phaseFn(def),cache=new Map(),get=t=>{const id=t.toFixed(4);let r=cache.get(id);if(!r){r=pose(def.P(Math.min(1,Math.max(0,t/def.d)),t),ph(t),t);cache.set(id,r);}return r;};
    const tracks=animated.map(b=>k.sample(b,'rotation',def.d,30,t=>get(t).R[b.name]));tracks.push(k.sample(root,'position',def.d,30,t=>get(t).pos));
    k.clip(def.name,def.d,tracks).userData={loop:def.loop};}
  k.edges(stage,{color:'#080e15',thickness:.65,worldThickness:.002,creaseAngle:55,silhouette:true,creases:true});
  k.root.userData.smartTopologyBefore=k.quality().score;k.root.userData.smartFix=k.fixTopology({relaxIterations:0});k.root.userData.smartTopology=k.quality().score;
  k.root.userData.assetInfo={studMeters:S,forward:'scene +X',animations:defs.map(({name,d,loop})=>({name,duration:d,loop})),squareStuds:true};
}
