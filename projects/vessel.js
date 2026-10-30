export function build(k) {
  const {mesh,group,material,csg,sample,clip,parameters:p}=k;
  const metal=material(p.color,{metalness:p.metalness,roughness:0.28}), ink=material('#25323a',{roughness:0.65}), orange=material('#e5a04a');
  const profile=[[0.48,0],[0.59,0.1],[0.62,0.22],[0.62,1.48],[0.57,1.6],[0.42,1.7],[0.42,1.85],[0.32,1.85],[0.32,1.69],[0.47,1.55],[0.51,1.42],[0.51,0.2],[0,0.2],[0,0]];
  mesh('Vessel','lathe',[profile,64],metal,{at:[0,0.15,0]});
  const lid=group('Lid',{at:[0,2.08,0]});
  mesh('Cap','cylinder',[0.47,0.47,0.18,64],ink,{parent:lid});
  mesh('CapRing','torus',[0.43,0.025,8,64],orange,{parent:lid,rotate:[Math.PI/2,0,0],at:[0,-0.06,0]});
  const body=mesh('RawHandle','roundedBox',[0.9,0.34,0.24,3,0.06],metal,{at:[0,2.29,0]});
  const cutter=mesh('HandleCut','box',[0.56,0.14,0.6],ink,{at:[0,2.29,0]});
  const handle=csg('Handle',body,cutter); lid.attach(handle);
  for(const y of [0.31,0.39,1.46])mesh(`Ridge${String(y).replace('.','_')}`,'torus',[0.625,0.018,8,64],ink,{rotate:[Math.PI/2,0,0],at:[0,y,0]});
  mesh('Badge','roundedBox',[0.2,0.33,0.035,2,0.025],orange,{at:[0,0.91,0.625]});
  clip('Assembly',4,[sample(lid,'position',4,30,t=>[0,2.08+Math.sin(Math.PI*t/4)**2*0.9,0]),sample(lid,'rotation',4,30,t=>[0,Math.sin(Math.PI*t/4)**2*Math.PI,0])]);
}
