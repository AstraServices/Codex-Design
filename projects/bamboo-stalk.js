// Cartoon simulator bamboo stalk: one closed, skinned lathe surface with bulging segments,
// dark node rings and a cut top, plus Sway and Hit clips.
export function build(k) {
  const {THREE,parameters:p,bone,skin,clip,sample}=k;
  const R=p.radius,H=p.height;
  // Segment lengths (relative); the last one is the short cut-off top piece.
  const rel=[1,0.95,0.9,0.6],sum=rel.reduce((a,b)=>a+b,0);
  const nodes=[];let acc=0;
  for(let i=0;i<rel.length-1;i++){acc+=rel[i]/sum*H;nodes.push(acc);}
  const nh=0.095; // node band height

  // Profile rows [radius, y, tone]; tone 0 = stalk, 1 = node ring, 2 = cut face.
  const prof=[[0,0,0],[R*0.55,0,0],[R*0.88,0.008,0],[R*0.98,0.045,0]];
  const segment=(y0,y1,steps)=>{for(let i=1;i<steps;i++){const s=i/steps;prof.push([R*(0.985+0.025*Math.sin(Math.PI*s)),y0+(y1-y0)*s,0]);}};
  let y=0.045;
  for(const n of nodes){
    segment(y,n-nh,8);
    prof.push([R*0.975,n-nh,0.6],[R*1.02,n-nh*0.5,1],[R*1.03,n,1],[R*1.02,n+nh*0.5,1],[R*0.975,n+nh,0.6]);
    y=n+nh;
  }
  // Last segment ends in a hemisphere dome (radius R) that reaches the full height H.
  const dome=H-R;
  segment(y,dome,6);
  for(let i=0;i<=8;i++){const a=i/8*Math.PI/2;prof.push([i===8?0:R*Math.cos(a),dome+R*Math.sin(a),0]);}

  const U=28,V=prof.length-1;
  const g=k.quadSurface((u,v)=>{const [r,py]=prof[Math.round(v*V)],a=-u*Math.PI*2;return [Math.cos(a)*r,py,Math.sin(a)*r];},{uSegments:U,vSegments:V});
  // Weld the seam and cap poles so shading has no visible split.
  const nrm=g.attributes.normal,row=U+1,tmp=new THREE.Vector3();
  for(let v=0;v<=V;v++){
    const a=v*row,b=a+U;
    if(prof[v][0]===0){const s=v===0?-1:1;for(let u=0;u<=U;u++)nrm.setXYZ(a+u,0,s,0);continue;}
    tmp.set(nrm.getX(a)+nrm.getX(b),nrm.getY(a)+nrm.getY(b),nrm.getZ(a)+nrm.getZ(b)).normalize();
    nrm.setXYZ(a,tmp.x,tmp.y,tmp.z);nrm.setXYZ(b,tmp.x,tmp.y,tmp.z);
  }
  // Vertex colors: darker base to brighter top, lighter mid-segment, dark nodes, pale cut face.
  const base=new THREE.Color(p.color),low=base.clone().multiplyScalar(0.7),high=base.clone().lerp(new THREE.Color('#e6ff9a'),0.22);
  const node=new THREE.Color(p.nodeColor),cut=new THREE.Color(p.cutColor),col=[],c=new THREE.Color();
  const bounds=[0,...nodes,H];
  for(let v=0;v<=V;v++){
    const [,py,tone]=prof[v];
    c.copy(low).lerp(high,py/H);
    const i=bounds.findIndex(b=>b>py),s=i>0?(py-bounds[i-1])/(bounds[i]-bounds[i-1]):0;
    c.multiplyScalar(0.94+0.1*Math.sin(Math.PI*s));
    if(tone===2)c.copy(cut);else if(tone>0)c.lerp(node,tone);
    for(let u=0;u<=U;u++)col.push(c.r,c.g,c.b);
  }
  g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));

  // Soft vertical fibre streaks around the circumference (multiplied with vertex color).
  const W=128,Ht=64,fibre=k.pixelTexture(W,Ht,(u,v)=>{
    const s=0.5+0.5*Math.sin(u*Math.PI*2*6+k.noise(u,v,24)*1.5);
    const l=Math.round(232+18*s-12*k.fbm(u,v,8));return [l,l,l,255];
  },{repeat:[1,1]});
  const mat=k.material('#ffffff',{vertexColors:true,map:fibre,roughness:0.55,metalness:0});
  mat.name='BambooSkin';

  // Skeleton: base, one bone per node, tip.
  const ys=[0,...nodes,H],bones=[];
  ys.forEach((by,i)=>bones.push(bone(i===0?'Base':i===ys.length-1?'Tip':`Node${i}`,{parent:i?bones[i-1]:k.root,at:[0,i?by-ys[i-1]:0,0]})));
  skin('BambooStalk',g,mat,bones,v=>{
    let j=0;while(j<ys.length-2&&v.y>=ys[j+1])j++;
    const w=Math.min(1,Math.max(0,(v.y-ys[j])/(ys[j+1]-ys[j])));
    return [[j,1-w],[j+1,w]];
  });

  const sway=bones.slice(1,-1);
  // Jelly Sway (4 s loop): bending plus a faster harmonic and volume-preserving squash per segment.
  const w=Math.PI/2,sq=a=>[1/Math.sqrt(1+a),1+a,1/Math.sqrt(1+a)];
  clip('Sway',4,[
    sample(bones[0],'scale',4,30,t=>sq(0.035*Math.sin(t*w*4))),
    ...sway.flatMap((b,i)=>[
      sample(b,'rotation',4,30,t=>{const a=t*w-i*0.7;return [Math.sin(a+0.8)*0.03+Math.sin(a*3)*0.012,0,(Math.sin(a)*0.05+Math.sin(a*3+i)*0.02)*(1+i*0.3)];}),
      sample(b,'scale',4,30,t=>sq(0.03*Math.sin(t*w*4-i*1.1)))])
  ]);
  // Jelly Hit: big squash on the base, then a springy wobble on two axes that ripples up the stalk.
  const D=1.8;
  clip('Hit',D,[
    sample(bones[0],'scale',D,30,t=>sq(-0.18*Math.exp(-t*3.2)*Math.cos(t*18))),
    ...sway.flatMap((b,i)=>{const d=t=>Math.exp(-(t-i*0.05)*2.6)*(t>i*0.05?1:0);return [
      sample(b,'rotation',D,30,t=>[Math.sin(t*13-i*0.8)*0.06*d(t),0,Math.sin(t*17-i*0.9)*0.16*(1+i*0.3)*d(t)]),
      sample(b,'scale',D,30,t=>sq(0.12*d(t)*Math.cos(t*20-i*1.2)))];})
  ]);
}
