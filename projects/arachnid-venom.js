import {createMaterials} from './arachnid-venom-assets/materials.js';
import {addAnimations} from './arachnid-venom-assets/animations.js';
import {toCreasedNormals} from 'three/addons/utils/BufferGeometryUtils.js';

// VESPER: deterministic production recipe. +Z forward / Y up / meters.
// Closed, outward-facing armor is rigid-weighted to the articulated skeleton.
export async function build(k) {
  const T=k.THREE, V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
  const mats=await createMaterials(T);
  // Hero-grade surfaces; color ramps are authored in bind space and exported.
  mats.armor=k.pbrSurface({name:'Vesper_Iridescent_Chitin',normal:.7,metal:true,
    height(u,v){return .55+k.tex.fbm(u,v,32,3,9)*.025+Math.pow(Math.abs(Math.sin((u*15+v*3)*Math.PI)),65)*.008;},
    albedo(c){return k.tex.ramp([[0,'#263b52'],[.48,'#45697f'],[.72,'#63758c'],[1,'#9eb4c0']],.48+c.n*.08);},
    roughness(c){return .37+.08*c.n;},metalness(){return .72;}},{size:1024});
  mats.armor.name='Iridescent_Chitin_Gradient_PBR';
  mats.edge.color.set('#8c877b'); mats.edge.roughness=.42;
  mats.bone.color.set('#9cb9c4'); mats.bone.roughness=.29;
  mats.glow.color.set('#079d30'); mats.glow.emissive.set('#03c42d');mats.glow.roughness=.34;
  mats.glow.emissiveIntensity=.54;
  const venomDef={name:'Vesper_Living_Venom',normal:2.2,
    height(u,v){const cell=k.tex.cells(u,v,9,19);return {h:.35+.24*k.tex.fbm(u,v,16,4,7)+.25*k.tex.smooth(.01,.12,cell.edge),mask:k.tex.smooth(.012,.07,cell.edge),id:cell.id};},
    albedo(c){return k.tex.ramp([[0,'#035a43'],[.20,'#07963d'],[.55,'#32d922'],[1,'#b1f83c']],c.mask*(.35+c.id*.5+c.v*.15));},
    roughness(c){return .22+.17*c.h;},metalness(){return .02;},
    emissive(c){return [.003,.16+.16*c.h,.012];}};
  mats.venom=k.pbrSurface(venomDef,{size:1024,emissive:'#24f257',emissiveIntensity:k.parameters.venomIntensity??.8});
  mats.venom.name='Living_Venom_Gradient_PBR';
  for(const m of Object.values(mats))m.vertexColors=true;
  const sceneRoot=k.bone('SceneRoot');
  const root=k.bone('MotionRoot',{parent:sceneRoot,at:[0,2,0]});
  const thorax=k.bone('Thorax',{parent:root});
  const abdomen=k.bone('Abdomen',{parent:thorax,at:[0,.45,-1.45]});
  const head=k.bone('Head',{parent:thorax,at:[0,-.04,1]});
  const mandibles=[1,-1].map((s,i)=>k.bone(`Mandible_${i?'R':'L'}`,{parent:head,at:[s*.5,-.28,.5]}));
  const palps=[1,-1].map((s,i)=>k.bone(`Palp_${i?'R':'L'}`,{parent:head,at:[s*.73,-.05,.18]}));
  const points=[[[.68,.05,.8],[1.95,.52,1.9],[2.85,-.65,2.8],[3.25,-1.97,3.45]],[[.86,.05,.28],[2.48,.74,.72],[3.35,-.66,1.02],[3.75,-1.97,1.35]],[[.86,.02,-.38],[2.5,.64,-.85],[3.45,-.68,-1.5],[3.8,-1.97,-1.85]],[[.7,.02,-.94],[2,.56,-2.05],[2.85,-.67,-2.95],[3.15,-1.97,-3.55]]];
  const legs=[];
  for(const side of [1,-1])for(let row=0;row<4;row++){
    const p=points[row].map(a=>V(a[0]*side,a[1],a[2]));
    const label=`${side>0?'L':'R'}${row+1}`;
    const hip=k.bone(`Hip_${label}`,{parent:thorax,at:p[0].toArray()});
    const knee=k.bone(`Knee_${label}`,{parent:hip,at:p[1].clone().sub(p[0]).toArray()});
    const ankle=k.bone(`Ankle_${label}`,{parent:knee,at:p[2].clone().sub(p[1]).toArray()});
    const foot=k.bone(`Foot_${label}`,{parent:ankle,at:p[3].clone().sub(p[2]).toArray()});
    legs.push({side,row,hip,knee,ankle,foot,points:p});
  }
  k.root.updateMatrixWorld(true);
  const bones=[];sceneRoot.traverse(o=>{if(o.isBone)bones.push(o);});
  const batches=new Map();
  function emit(geo,mat,bone,local=new T.Matrix4(),blend){
    if(geo.index)geo=geo.toNonIndexed();
    else geo=geo.clone();
    if(!geo.attributes.uv)geo.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(geo.attributes.position.count*2),2));
    const transform=bone.matrixWorld.clone().multiply(local);
    geo.applyMatrix4(transform);
    const colors=[],cp=new T.Color(),a=new T.Color(),b=new T.Color();
    const gp=geo.attributes.position,gn=geo.attributes.normal,authoredColor=geo.attributes.color;
    const strength=k.parameters.gradientStrength??.8;
    for(let i=0;i<gp.count;i++){
      const x=gp.getX(i),y=gp.getY(i),z=gp.getZ(i),ny=gn.getY(i);
      const h=T.MathUtils.clamp((y-.1)/3.9,0,1);
      if(mat===mats.armor){
        a.set('#7599b8');b.set('#d1efff');cp.copy(a).lerp(b,h);
        cp.lerp(new T.Color('#6d547c'),Math.max(0,Math.sin(z*1.9+Math.abs(x)*.6))*.25);
        cp.multiplyScalar(.86+Math.max(0,ny)*.14);
      }else if(mat===mats.venom){
        a.set('#078f69');b.set('#96ff16');cp.copy(a).lerp(b,T.MathUtils.clamp(h*.7+.22+Math.sin(Math.abs(x)*6+z*5)*.12,0,1));
      }else if(mat===mats.bone||mat===mats.edge){a.set('#3d4b60');b.set('#d1c4a0');cp.copy(a).lerp(b,h*.65+Math.max(0,ny)*.3);}
      else cp.set('#ffffff');
      cp.lerp(new T.Color('#ffffff'),1-strength);
      if(authoredColor)cp.multiply(new T.Color().fromBufferAttribute(authoredColor,i));
      colors.push(cp.r,cp.g,cp.b);
    }
    geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    const ids=[],weights=[],bi=bones.indexOf(bone);
    for(let i=0;i<geo.attributes.position.count;i++){
      const mix=blend?blend(i,geo):null;
      ids.push(bi,mix?bones.indexOf(mix[0]):0,0,0);weights.push(mix?1-mix[1]:1,mix?mix[1]:0,0,0);
    }
    geo.setAttribute('skinIndex',new T.Uint16BufferAttribute(ids,4));
    geo.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
    if(!batches.has(mat))batches.set(mat,[]);batches.get(mat).push(geo);
  }
  function matrix(pos,scale=[1,1,1],quat=new T.Quaternion()){
    return new T.Matrix4().compose(pos,quat,V(...scale));
  }
  function orb(bone,pos,scale,mat=mats.armor,segments=12,rings=8,quat=new T.Quaternion()){
    emit(new T.SphereGeometry(1,segments,rings),mat,bone,matrix(V(...pos),scale,quat));
  }
  function tube(bone,pts,radii,mat=mats.armor,sides=8){
    let ps=pts.map(a=>Array.isArray(a)?V(...a):a.clone());
    let rr=radii.map(r=>Array.isArray(r)?r:[r,r]);
    // Rings follow taper/length instead of leaving needle-thin stretched triangles.
    const sampled=[ps[0]],sr=[rr[0]];
    for(let j=1;j<ps.length;j++){
      const avg=(rr[j-1][0]+rr[j-1][1]+rr[j][0]+rr[j][1])/4;
      const steps=Math.max(1,Math.ceil(ps[j].distanceTo(ps[j-1])/Math.max(.02,avg*5)));
      for(let n=1;n<=steps;n++){const t=n/steps;sampled.push(ps[j-1].clone().lerp(ps[j],t));sr.push(rr[j-1].map((r,a)=>T.MathUtils.lerp(r,rr[j][a],t)));}
    }
    ps=sampled;rr=sr;const positions=[],uv=[],idx=[];
    let previousU=null;const distances=[0];
    for(let j=1;j<ps.length;j++)distances.push(distances[j-1]+ps[j].distanceTo(ps[j-1]));
    const pointed=Math.max(...rr.at(-1))<=.009;
    for(let j=0;j<ps.length-(pointed?1:0);j++){
      const tangent=ps[Math.min(j+1,ps.length-1)].clone().sub(ps[Math.max(0,j-1)]).normalize();
      const ref=Math.abs(tangent.y)>.9?V(1,0,0):V(0,1,0);
      // Parallel transport avoids the old 90-degree twist when the reference axis changes.
      const u=previousU?previousU.clone().addScaledVector(tangent,-previousU.dot(tangent)):new T.Vector3().crossVectors(tangent,ref);
      if(u.lengthSq()<1e-8)u.crossVectors(tangent,ref);
      u.normalize();previousU=u.clone();const v=new T.Vector3().crossVectors(tangent,u).normalize();
      const rad=rr[j];
      for(let a=0;a<=sides;a++){
        const ang=a/sides*Math.PI*2,p=ps[j].clone().addScaledVector(u,Math.cos(ang)*rad[0]).addScaledVector(v,Math.sin(ang)*rad[1]);
        positions.push(...p.toArray());uv.push(a/sides,distances[j]/distances.at(-1));
        if(j&&a){const h=j*(sides+1)+a;idx.push(h-1,h-sides-2,h,h-sides-2,h-sides-1,h);}
      }
    }
    if(pointed){
      const tip=positions.length/3,base=(ps.length-2)*(sides+1);
      positions.push(...ps.at(-1).toArray());uv.push(.5,1);
      for(let a=0;a<sides;a++)idx.push(base+a,base+a+1,tip);
    }
    // Caps use separate planar UVs and normals instead of collapsed strip UVs.
    for(const j of (pointed?[0]:[0,ps.length-1])){
      const c=positions.length/3;positions.push(...ps[j].toArray());uv.push(.5,j?1:0);
      const base=positions.length/3;
      for(let a=0;a<sides;a++){const q=j*(sides+1)+a;positions.push(...positions.slice(q*3,q*3+3));uv.push(.5+.5*Math.cos(a/sides*Math.PI*2),.5+.5*Math.sin(a/sides*Math.PI*2));}
      for(let a=0;a<sides;a++){const q=base+a,n=base+(a+1)%sides;if(j)idx.push(c,q,n);else idx.push(c,n,q);}
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
    const normals=g.attributes.normal,nv=V();
    for(let j=0;j<ps.length-(pointed?1:0);j++){
      const a=j*(sides+1),b=a+sides;nv.fromBufferAttribute(normals,a).add(V().fromBufferAttribute(normals,b)).normalize();normals.setXYZ(a,nv.x,nv.y,nv.z);normals.setXYZ(b,nv.x,nv.y,nv.z);
    }
    emit(g,mat,bone);
  }
  function ring(bone,pos,normal,radius,tubeRadius,mat=mats.edge){
    const q=new T.Quaternion().setFromUnitVectors(V(0,0,1),normal.clone().normalize());
    emit(new T.TorusGeometry(radius,tubeRadius,4,12),mat,bone,matrix(pos,[1,1,1],q));
  }
  // Outward winding, explicit bevels and face normals keep every plate solid.
  function plate(bone,pos,width,length,height,quat=new T.Quaternion(),mat=mats.armor,trim=true){
    const outline=[[-.48,-.28],[-.42,.16],[-.25,.4],[0,.6],[.25,.4],[.42,.16],[.48,-.28],[.25,-.5],[0,-.58],[-.25,-.5]];
    const p=[],uv=[],ix=[];
    const layers=[[.9,-.065],[1,0],[1,height*.20],[.78,height*.65]];
    for(const [r,y]of layers)for(const [x,z]of outline){p.push(x*width*r,y,z*length*r);uv.push(x*r+.5,(z*r+.58)/1.18);}
    const c=p.length/3;p.push(0,height,0);uv.push(.5,.5);
    const b=p.length/3;p.push(0,-.065,0);uv.push(.5,.5);
    for(let i=0;i<10;i++){
      const n=(i+1)%10;ix.push(c,30+i,30+n,b,n,i);
      for(let layer=0;layer<3;layer++){const a=layer*10+i,d=layer*10+n;ix.push(a,d,a+10,d,d+10,a+10);}
    }
    let g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(ix);g=toCreasedNormals(g,.5);
    if(trim){
      // Color the existing bevel: no overlapping sheets or hair-thin strip walls.
      const a=g.attributes.position,colors=[],c=new T.Color();
      for(let i=0;i<a.count;i+=3){
        const ys=[a.getY(i),a.getY(i+1),a.getY(i+2)];
        const bevel=Math.min(...ys)>=height*.19&&Math.max(...ys)<=height*.66;
        c.set(bevel?'#c4b99e':'#ffffff');for(let j=0;j<3;j++)colors.push(c.r,c.g,c.b);
      }
      g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    }
    emit(g,mat,bone,matrix(pos,[1,1,1],quat));
  }
  function spike(bone,start,dir,length,radius=.07){
    const d=dir.clone().normalize();
    tube(bone,[start,start.clone().addScaledVector(d,length*.55),start.clone().addScaledVector(d,length).add(V(0,0,-length*.15))],[radius,radius*.48,.003],mats.bone,5);
  }
  // Broad cephalothorax, undercarriage and independently breathing abdomen.
  orb(thorax,[0,0,-.05],[1.05,.59,1.18],mats.dark,20,12);
  orb(thorax,[0,-.32,.05],[.83,.3,.98],mats.armor,16,8);
  orb(abdomen,[0,0,0],[1.13,1.03,1.52],mats.dark,20,14);
  // Abdominal shields: open channels expose the six organic toxin reservoirs.
  for(const s of [1,-1]){
    for(let j=0;j<3;j++){
      const z=.83-j*.76,y=.7+(.12-Math.abs(z)*.1),x=s*(.59+(.12-Math.abs(z)*.12));
      orb(abdomen,[x,y-.02,z],[.48,.45,.55],mats.venom,20,12);
      // Nested cells, raised capillaries and dark bezels integrate sacs with armor.
      for(let c=0;c<5;c++){
      const ang=c*Math.PI*2/5,ox=Math.cos(ang)*.23,oz=Math.sin(ang)*.29;
        orb(abdomen,[x+ox,y+.245,z+oz],[.14,.14,.17],mats.venom,12,8);
      }
      for(let v=0;v<3;v++){
        const off=(v-1)*.16;
        // Follow the actual ellipsoid; the former polyline floated off its surface.
        const path=Array.from({length:13},(_,i)=>{const zz=.43-i*.068,xx=off*(.8+.2*Math.sin(i/12*Math.PI));return [x+xx,y-.02+.45*Math.sqrt(Math.max(0,1-(xx/.48)**2-(zz/.55)**2))-.007,z+zz];});
        tube(abdomen,path,path.map(()=>.012),mats.dark,6);
      }
      // Teardrop armor mounting rails flank each sac.
      plate(abdomen,V(s*.99,.52,z-.08),.5,.92,.16,new T.Quaternion().setFromEuler(new T.Euler(0,s*.12,s*-.72)));
      plate(abdomen,V(s*.31,.97,z-.1),.37,.87,.16,new T.Quaternion().setFromEuler(new T.Euler(0,s*-.12,s*.28)));
      tube(abdomen,[[s*.94,.45,z+.35],[s*.99,.81,z],[s*.72,1.12,z-.34]],[.037,.04,.025],mats.armor,6);
      spike(abdomen,V(s*.94,.71,z-.23),V(s*.65,.75,-.28),.35,.095);
    }
    for(let j=0;j<5;j++)plate(abdomen,V(s*.82,.03,.95-j*.46),.6,.63,.19,new T.Quaternion().setFromEuler(new T.Euler(0,0,-s*1.1)));
    tube(abdomen,[[s*.88,-.38,1.02],[s*1.07,-.36,.3],[s*.96,-.35,-.8],[s*.4,-.26,-1.42]],[.045,.05,.04,.014],mats.glow,5);
  }
  for(let j=0;j<6;j++){
    const z=1.12-j*.43;
    plate(abdomen,V(0,.95,z),.64,.64,.23,new T.Quaternion().setFromEuler(new T.Euler((j-2)*-.07,0,0)));
    spike(abdomen,V(0,1.12,z-.12),V(0,.7,-.5),.35+(j>3?.12:0),.10);
  }
  plate(abdomen,V(0,.35,-1.39),1.03,.8,.21,new T.Quaternion().setFromEuler(new T.Euler(-1.0,0,0)));
  // Overlapping thoracic scutes and shoulder fans.
  for(let j=0;j<3;j++)plate(thorax,V(0,.57,.68-j*.56),1.25,.88,.24);
  for(const s of [1,-1])for(let j=0;j<3;j++){
    plate(thorax,V(s*.69,.4,.62-j*.56),.72,.76,.22,new T.Quaternion().setFromEuler(new T.Euler(0,s*-.2,-s*.5)));
    spike(thorax,V(s*.88,.49,.46-j*.5),V(s*.6,.6,-.4),.35,.09);
  }
  // Face: layered brow over eight inset lenses; sensors follow curved frontal surface.
  orb(head,[0,0,.13],[.79,.55,.61],mats.armor,18,10);
  plate(head,V(0,.48,.13),1.2,.9,.22,new T.Quaternion().setFromEuler(new T.Euler(.30,0,0)));
  for(const s of [1,-1]){
    plate(head,V(s*.55,.19,.36),.49,.69,.17,new T.Quaternion().setFromEuler(new T.Euler(.95,s*.36,-s*.48)));
    const eyes=[[.25,.22,.66,.145],[.55,.13,.53,.095],[.18,-.03,.71,.085],[.42,-.13,.61,.075]];
    for(const [x,y,z,r]of eyes){
      const normal=V(s*x*.5,y*.3,1).normalize(),q=new T.Quaternion().setFromUnitVectors(V(0,0,1),normal),center=V(s*x,y,z);
      orb(head,center.toArray(),[r*1.34,r*1.34,r*.65],mats.dark,16,10,q);
      ring(head,center.clone().addScaledVector(normal,.028),normal,r*1.06,.018,mats.edge);
      orb(head,center.clone().addScaledVector(normal,.044).toArray(),[r*.92,r*.92,r*.5],mats.glow,16,10,q);
    }
    spike(head,V(s*.61,.36,.23),V(s*.4,.65,-.25),.32,.075);
  }
  // Central mouth grille and six needle teeth.
  orb(head,[0,-.3,.58],[.31,.23,.17],mats.dark,10,6);
  for(let i=0;i<6;i++)spike(head,V((i-2.5)*.095,-.18,.72),V(0,-1,.36),.22+(i%2)*.08,.038);
  for(let n=0;n<2;n++){
    const s=n? -1:1,b=mandibles[n];
    orb(b,[0,0,0],[.22,.25,.24],mats.dark);
    ring(b,V(0,0,.13),V(0,0,1),.2,.045);
    const f=[[0,0,0],[s*.24,-.15,.32],[s*.32,-.43,.58],[s*.22,-.73,.84],[-s*.04,-.84,1.03]];
    tube(b,f,[[.18,.21],[.21,.17],[.14,.115],[.08,.065],[.004,.004]],mats.armor,8);
    tube(b,f.map(a=>[a[0]-s*.07,a[1]+.055,a[2]+.03]),[.035,.035,.028,.018,.003],mats.glow,5);
    for(let j=1;j<4;j++)spike(b,V(...f[j]),V(-s*.7,-.2,.4),.18,.048);
    plate(b,V(s*.08,-.04,.18),.4,.55,.13,new T.Quaternion().setFromEuler(new T.Euler(.8,s*.3,0)));
    const p=palps[n];
    tube(p,[[0,0,0],[s*.28,-.22,.32],[s*.33,-.5,.56],[s*.17,-.59,.74]],[.13,.13,.085,.008],mats.armor,7);
    ring(p,V(s*.28,-.22,.32),V(s,0,0),.13,.026);
    spike(p,V(s*.29,-.4,.44),V(s*.8,.15,.7),.22,.055);
  }
  // Eight segmented limbs. Each limb has coxa/femur/tibia/tarsus silhouette and overlapping armor.
  for(const leg of legs){
    const {side,row,points:p}=leg;
    for(let part=0;part<3;part++){
      const bone=[leg.hip,leg.knee,leg.ankle][part],end=p[part+1].clone().sub(p[part]);
      const len=end.length(),dir=end.clone().normalize(),thickness=[.225,.185,.118][part];
      const up=V(0,1,0).addScaledVector(dir,-dir.y).normalize();
      const cross=new T.Vector3().crossVectors(up,dir).normalize();
      const basis=new T.Matrix4().makeBasis(cross,up,dir),q=new T.Quaternion().setFromRotationMatrix(basis);
      const mid=end.clone().multiplyScalar(.43).addScaledVector(up,.075);
      tube(bone,[V(),end.clone().multiplyScalar(.12),mid,end.clone().multiplyScalar(.8),end],[thickness*.65,[thickness,thickness*.75],[thickness*.9,thickness*.75],[thickness*.55,thickness*.44],part===2?.008:thickness*.37],mats.dark,8);
      const plates=part===0?4:part===1?5:4;
      for(let j=0;j<plates;j++){
        const t=.16+j*(.7/plates),pos=end.clone().multiplyScalar(t).addScaledVector(up,thickness*.58+.025+(plates-j)*.012);
        const factor=1-t*.6;
        plate(bone,pos,thickness*3.9*factor,len/plates*1.12,thickness*.78,q,mats.armor,true);
        spike(bone,pos.clone().addScaledVector(cross,thickness*.75),cross.clone().multiplyScalar(.65).addScaledVector(up,.55).addScaledVector(dir,-.4),(.16+.1*(1-t))*(part===2?.75:1),.055*factor);
      }
      // Fluorescent fluid line along the exposed medial edge.
      const line=[.08,.32,.58,.86].map(t=>end.clone().multiplyScalar(t).addScaledVector(cross,-thickness*.7).addScaledVector(up,thickness*.05));
      tube(bone,line,line.map((_,i)=>.026-i*.004),mats.glow,5);
      if(part<2){
        orb(bone,end.toArray(),[thickness*.67,thickness*.67,thickness*.67],mats.dark,10,6);
        ring(bone,end,cross,thickness*.71,.033,mats.edge);
      }else{
        // A distinct polished, pointed terminal blade.
        tube(bone,[end.clone().multiplyScalar(.68),end.clone().multiplyScalar(.9),end],[.085,.052,.003],mats.bone,6);
      }
    }
    orb(leg.hip,[0,0,0],[.27,.26,.27],mats.dark,12,8);
    ring(leg.hip,V(),V(side,0,0),.255,.042,mats.edge);
    plate(leg.hip,V(side*.15,.18,0),.62,.6,.22,new T.Quaternion().setFromEuler(new T.Euler(0,0,-side*.45)));
  }
  // Segmented cervical collar, layered head crown and armored abdomen skirt.
  for(const s of [1,-1]){
    for(let j=0;j<4;j++){
      plate(abdomen,V(s*(.67+j*.10),.34-j*.13,1.08-j*.65),.72,.98,.24,new T.Quaternion().setFromEuler(new T.Euler(.12,s*.24,-s*.70)));
      spike(abdomen,V(s*(1.02-j*.03),.45,1.04-j*.7),V(s*.72,.38,-.55),.43,.10);
    }
    for(let j=0;j<3;j++){
      plate(head,V(s*(.20+j*.19),.47-j*.045,.41-j*.18),.48,.68,.21,new T.Quaternion().setFromEuler(new T.Euler(.3,s*.12,-s*.28)));
    }
    tube(thorax,[[s*.42,.39,.85],[s*.86,.33,.55],[s*.96,.22,.05],[s*.83,.24,-.6]],[.055,.067,.065,.025],mats.edge,7);
    for(let j=0;j<5;j++){
      const z=.65-j*.30;
      plate(thorax,V(s*.57,-.48,z),.53,.46,.11,new T.Quaternion().setFromEuler(new T.Euler(0,0,s*2.3)),mats.dark,false);
    }
    // Three spinnerets mounted beneath the rear shell on each side.
    for(let j=0;j<3;j++)tube(abdomen,[[s*(.18+j*.2),-.25,-1.2],[s*(.25+j*.21),-.38,-1.58],[s*(.2+j*.23),-.50,-1.73]],[.095,.067,.015],mats.bone,7);
  }
  // A single spinal row avoids coplanar duplicate shields and exposed light wires.
  // Broad dorsal flying buttresses cover the reservoirs' roots, leaving windows.
  for(const s of [1,-1])for(let j=0;j<3;j++){
    const z=.85-j*.78;
    plate(abdomen,V(s*.93,.68,z-.12),.82,1.02,.28,new T.Quaternion().setFromEuler(new T.Euler(-.13,s*.25,-s*.78)));
    // Reservoir rails already exist; a second arch crossed the cell surfaces.
  }
  // Merge by material into few genuinely skinned meshes. Each weighted vertex references
  // the shared rest skeleton; no detached rigid export nodes or negative scale mirroring.
  let meshCount=0;
  for(const [mat,geos] of batches){
    const g=k.mergeGeometries(geos,false),si=g.attributes.skinIndex.array,sw=g.attributes.skinWeight.array;
    // Carry a portable tangent basis for normal maps into glTF/Roblox importers.
    if(mat.normalMap){
      g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i));g.computeTangents();
      const tang=g.attributes.tangent,norm=g.attributes.normal,tv=V(),nv=V();
      for(let i=0;i<tang.count;i++){
        tv.set(tang.getX(i),tang.getY(i),tang.getZ(i));
        if(tv.lengthSq()<1e-8||!Number.isFinite(tv.lengthSq())){
          nv.fromBufferAttribute(norm,i).normalize();
          tv.crossVectors(nv,Math.abs(nv.y)<.9?V(0,1,0):V(1,0,0)).normalize();
        }else tv.normalize();
        tang.setXYZW(i,tv.x,tv.y,tv.z,tang.getW(i)<0?-1:1);
      }
    }
    k.skin(`Vesper_${mat.name||'Surface'}_${meshCount++}`,g,mat,bones,(_,i)=>{
      const influences=[];for(let j=0;j<4;j++)if(sw[i*4+j]>0)influences.push([si[i*4+j],sw[i*4+j]]);return influences;
    });
    geos.forEach(g=>g.dispose());
  }
  k.root.userData={author:'Codex Design',asset:'VESPER — Venom Mech-Arachnid',units:'meters',forward:'+Z',rig:'SceneRoot at origin; 8 four-joint legs; rigid-weighted chitin',copyright:'Original procedural geometry based on user direction'};
  addAnimations(k,{root,thorax,abdomen,head,mandibles,palps,legs});
}
