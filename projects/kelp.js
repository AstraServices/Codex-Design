export function build(k) {
  const {THREE,parameters:p,material,mesh,bone,skin,clip,sample}=k;
  const bones=[],n=8,step=p.length/n;
  for(let i=0;i<=n;i++) bones.push(bone(`Joint${i}`,{parent:i?bones[i-1]:k.root,at:[0,i?step:0.15,0]}));
  // Author the deforming surface with regular quad rings, then triangulate for WebGL/glTF.
  const side=k.quadSurface((u,v)=>{const a=-u*Math.PI*2,r=p.radius*(1-v)+0.035*v;return [Math.cos(a)*r,0.15+v*p.length,Math.sin(a)*r];},{uSegments:24,vSegments:64});
  const bottom=new THREE.CircleGeometry(p.radius,24);bottom.rotateX(Math.PI/2);bottom.translate(0,0.15,0);
  const top=new THREE.CircleGeometry(0.035,24);top.rotateX(-Math.PI/2);top.translate(0,p.length+0.15,0);
  const g=k.mergeGeometries([side,bottom,top]);g.userData={...side.userData};side.dispose();bottom.dispose();top.dispose();
  skin('SoftBody',g,material(p.color,{roughness:0.35,metalness:0.1}),bones,v=>{
    const u=Math.max(0,Math.min(n,(v.y-0.15)/step)),a=Math.min(n-1,Math.floor(u)),w=u-a;
    return [[a,1-w],[a+1,w]];
  });
  mesh('RootStone','icosahedron',[0.46,2],material('#53615f',{roughness:0.92}),{scale:[1,0.5,1],at:[0,0.05,0]});
  for(let i=0;i<5;i++)mesh(`Pebble${i}`,'icosahedron',[0.15,1],material('#8d9a8b',{roughness:1}),{at:[Math.cos(i*1.257)*0.5,0.02,Math.sin(i*1.257)*0.5],scale:[1,0.4,1]});
  clip('Sway',4,bones.slice(1).map((b,i)=>sample(b,'rotation',4,30,t=>[Math.sin(t*Math.PI/2+i*0.3)*0.07,0,Math.sin(t*Math.PI/2+i*0.4)*0.15])));
  clip('Curl',4,bones.slice(1).map((b,i)=>sample(b,'rotation',4,30,t=>[0,0,Math.sin(t*Math.PI/4)**2*0.32*(1+i*0.1)])));
}
