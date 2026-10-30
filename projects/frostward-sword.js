export async function build(k) {
  const S=k.STUD,T=k.THREE;
  // Assemble first, then bake each surface once with the complete model bounds.
  const surfaces=[];
  const paint=(mesh,options)=>{surfaces.push([mesh,options]);return mesh;};
  const look={rim:0.82,rimMode:'gain',rimGain:1.4,rimLift:0.085,rimWidth:0.15,rimSoftness:0.88,rimSaturate:0.9,glow:0,vignette:0.28,vignetteStart:0.06,vignetteEnd:0.95,vignettePower:0.85,faceGradient:0.12,ao:0.45,sheen:0.06,sheenWidth:0.16,emissiveRim:0};
  const navy=[[0,'#101c45'],[0.42,'#293d73'],[0.75,'#52699b'],[1,'#8ea8cf']];
  const cyan=[[0,'#12538e'],[0.35,'#248cc5'],[0.7,'#60d8ed'],[1,'#c3f7ff']];
  const ramp=(stops,from='bottom-left',to='top-right')=>({type:'linear',from,to,space:'part',ease:'smooth',stops});
  const finish=async(m,stops,extra={})=>{paint(m,{studs:'none',look,crease:25,hardAngle:25,pxPerStud:48,maxAtlas:1024,roughness:0.38,metalness:0.06,gradient:[ramp(stops),{type:'normal',direction:[0.35,0.8,1],mode:'multiply',amount:0.35,stops:[[0,'#405581'],[1,'#ffffff']]}],...extra});return m;};
  // One real chamfer segment; dimensions are integer studs at outside bounds.
  async function block(name,size,at,stops=navy,b=0.10){
    const [w,h,d]=size.map(v=>v*S),r=b*S;
    const g=k.geometry('extrude',[[[-w/2+r,-h/2+r],[w/2-r,-h/2+r],[w/2-r,h/2-r],[-w/2+r,h/2-r]],{depth:d-2*r,steps:1,bevelEnabled:true,bevelSegments:1,bevelSize:r,bevelThickness:r,curveSegments:1}]);g.translate(0,0,-d/2+r);
    return finish(k.mesh(name,g,null,k.material('#ffffff'),{at:at.map(v=>v*S)}),stops);
  }
  function poly(vertices,faces){
    const center=new T.Vector3();vertices.forEach(v=>center.add(new T.Vector3(...v)));center.divideScalar(vertices.length);const pos=[];
    for(let face of faces){face=face.slice();const a=new T.Vector3(...vertices[face[0]]),b=new T.Vector3(...vertices[face[1]]),c=new T.Vector3(...vertices[face[2]]),fc=new T.Vector3();face.forEach(i=>fc.add(new T.Vector3(...vertices[i])));fc.divideScalar(face.length);if(b.clone().sub(a).cross(c.clone().sub(a)).dot(fc.sub(center))<0)face.reverse();for(let j=1;j<face.length-1;j++)for(const i of [face[0],face[j],face[j+1]])pos.push(...vertices[i].map(n=>n*S));}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.computeVertexNormals();return g;
  }
  const section=[[-3,0.35],[-1.6,1],[0,1.5],[2.4,1],[3,0.35],[3,-0.35],[1.6,-1],[0,-1.5],[-2.4,-1],[-3,-0.35]];
  const ys=[18,22,26,30,34,38,42],v=[],f=[],n=section.length;
  for(const y of ys)for(const [x,z] of section)v.push([x,y,z]);
  for(let j=0;j<ys.length-1;j++)for(let i=0;i<n;i++)f.push([j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i]);
  f.push(Array.from({length:n},(_,i)=>n-1-i));const tip=v.length;v.push([0,46,0]);for(let i=0;i<n;i++)f.push([(ys.length-1)*n+i,(ys.length-1)*n+(i+1)%n,tip]);
  const blade=k.mesh('FacetedBlade',poly(v,f),null,k.material('#ffffff'));
  paint(blade,{studs:'none',look:{...look,rim:0.7,rimWidth:0.12,vignette:0.23},crease:8,hardAngle:8,pxPerStud:40,maxAtlas:1024,roughness:0.3,metalness:0.16,gradient:[ramp([[0,'#16386f'],[0.35,'#4265a1'],[0.52,'#9dbce0'],[1,'#f7f9ff']],'left','right'),{type:'linear',from:'bottom',to:'top',space:'part',mode:'screen',amount:0.5,stops:[[0,'#000000'],[0.8,'#000000'],[1,'#dae6ff']]},{mode:'light',space:'part',bottom:0.72,top:1.07}],painter:{albedo:(ctx,col)=>{const band=Math.floor(ctx.world.y/(S*3)),factor=1+[0.01,-0.02,0.025,-0.008][((band%4)+4)%4];return col.map(c=>Math.min(1,Math.max(0,c*factor)));}}});
  for(const [i,y] of [22,28,34,40].entries()){const p=await block('BladePlaque'+(i+1),[2,2,1],[1.5,y,1.3],[[0,'#708fbf'],[0.5,'#b4cce8'],[1,'#f2f7ff']],0.12);p.rotation.y=0.12;}
  await block('GuardBeam',[14,4,4],[0,15,0]);await block('GuardLowerCollar',[6,2,3],[0,12.5,-0.2]);
  for(const side of [-1,1]){const q=side<0?'L':'R';await block('GuardStep'+q,[4,3,3],[side*4.65,16.1,-0.15]);await block('GuardRaised'+q,[2,3,3],[side*3.5,18,0]);await block('GuardTipFrame'+q,[3,5,3],[side*7.5,17,0]);await block('GuardCyanTip'+q,[2,4,4],[side*9,17,0],cyan);await block('GuardTipStone'+q,[1,2,1],[side*9,17,2],cyan,0.08);await block('GuardFaceBoss'+q,[2,3,1],[side*4.5,15.35,2],[[0,'#334a7b'],[0.5,'#6e88b4'],[1,'#adbfe0']]);}
  await block('GuardCenterBezel',[4,5,2],[0,15.6,2],[[0,'#243d70'],[0.5,'#6c9bc2'],[1,'#d5f4fa']],0.18);
  async function gem(name,size,at){const [w,h,d]=size,verts=[[-w/2,-h/2,-d/2],[w/2,-h/2,-d/2],[w/2,h/2,-d/2],[-w/2,h/2,-d/2],[-w*0.33,-h*0.33,d*0.25],[w*0.33,-h*0.33,d*0.25],[w*0.33,h*0.33,d*0.25],[-w*0.33,h*0.33,d*0.25],[0,0,d/2]],faces=[[0,3,2,1],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,8],[5,6,8],[6,7,8],[7,4,8]];return finish(k.mesh(name,poly(verts,faces),null,k.material('#ffffff'),{at:at.map(v=>v*S)}),cyan,{roughness:0.23,metalness:0.08,look:{...look,rim:0.58,rimWidth:0.10,vignette:0.16}});}
  await gem('GuardSquareGem',[3,3,1],[0,15.6,3.5]);
  await block('GripCore',[4,7,3],[0,8.5,0],[[0,'#10172e'],[0.48,'#202d55'],[1,'#43557c']],0.08);
  // Taper ribbon sides into the handle: no coincident x-facing surfaces.
  for(let i=0;i<3;i++){
    const cy=6.4+i*2,pts=[[-2,cy+1.5],[2,cy-1.5],[2,cy-0.5],[-2,cy+2.5]];
    const verts=[...pts.map(([x,y])=>[x*0.94,y,0.65]),...pts.map(([x,y])=>[x,y,1.65])];
    const g=poly(verts,[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]);
    await finish(k.mesh('DiagonalGripWrap'+i,g,null,k.material('#ffffff')),[[0,'#172345'],[0.5,'#303e65'],[1,'#56658a']],{look:{...look,rim:0.52,rimWidth:0.10,vignette:0.18},roughness:0.52,metalness:0});
  }
  await block('GripFootCollar',[5,1,4],[0,5.45,0]);await block('PommelBody',[6,4,4],[0,3,0]);await block('PommelLeftEar',[1,3,3],[-3,3,0]);await block('PommelRightEar',[1,3,3],[3,3,0]);await block('PommelFoot',[4,1,3],[0,0.5,0]);await block('PommelBezel',[4,4,1],[0,3,2.4],[[0,'#213f74'],[0.5,'#668ab8'],[1,'#bde4f3']],0.16);await gem('PommelSquareGem',[3,3,1],[0,3,3.1]);
  for(const [mesh,options] of surfaces) await k.paint(mesh,{...options,gradient:[...options.gradient,{mode:'light',space:'model',bottom:0.84,top:1.04}]});
}
