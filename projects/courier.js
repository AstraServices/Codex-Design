export function build(k) {
  const {root,parameters:p,material:mat,mesh,group,bone,geometry,skin,clip,sample}=k;
  const shell=mat(p.color), dark=mat('#202e34',{metalness:0.65,roughness:0.3}), white=mat('#ddd8c9'), rubber=mat('#172025',{roughness:0.9});
  const glow=mat('#a9f9ed',{emissive:'#8df9df',emissiveIntensity:p.eyeGlow});
  const rig=group('Rig',{scale:p.height});
  const hips=bone('Hips',{parent:rig,at:[0,1.45,0]});
  const spine=bone('Spine',{parent:hips,at:[0,0.4,0]});
  const neck=bone('Neck',{parent:spine,at:[0,0.62,0]});
  mesh('Torso','roundedBox',[0.97,0.98,0.59,3,0.13],shell,{parent:spine,at:[0,0.03,0]});
  mesh('ChestPlate','roundedBox',[0.66,0.42,0.08,2,0.045],dark,{parent:spine,at:[0,0.08,0.31]});
  for(let i=0;i<3;i++) mesh(`ChestLight${i}`,'box',[0.1,0.035,0.015],glow,{parent:spine,at:[-0.17+i*0.17,0.08,0.36]});
  mesh('Waist','cylinder',[0.28,0.31,0.2,24],dark,{parent:hips});
  mesh('Pelvis','roundedBox',[0.72,0.3,0.47,2,0.08],white,{parent:hips,at:[0,-0.17,0]});
  mesh('Head','roundedBox',[1.1,0.73,0.7,4,0.17],shell,{parent:neck,at:[0,0.1,0]});
  mesh('Visor','roundedBox',[0.9,0.39,0.15,3,0.09],dark,{parent:neck,at:[0,0.12,0.34]});
  for(const s of [-1,1]) {
    const tag=s===1?'L':'R';
    mesh(`Eye${tag}`,'capsule',[0.065,0.1,4,10],glow,{parent:neck,at:[s*0.23,0.14,0.43],rotate:[0,0,Math.PI/2]});
    mesh(`Ear${tag}`,'cylinder',[0.17,0.17,0.1,24],dark,{parent:neck,at:[s*0.58,0.12,0],rotate:[0,0,Math.PI/2]});
    const arm=bone(`Arm${tag}`,{parent:spine,at:[s*0.65,0.33,0]});
    const elbow=bone(`Forearm${tag}`,{parent:arm,at:[0,-0.48,0]});
    mesh(`Shoulder${tag}`,'sphere',[0.2,20,12],dark,{parent:arm});
    mesh(`UpperArm${tag}`,'roundedBox',[0.29,0.4,0.32,2,0.07],shell,{parent:arm,at:[0,-0.25,0]});
    mesh(`ElbowJoint${tag}`,'sphere',[0.13,16,12],dark,{parent:elbow});
    mesh(`Sleeve${tag}`,'roundedBox',[0.31,0.34,0.34,2,0.07],white,{parent:elbow,at:[0,-0.23,0]});
    mesh(`Hand${tag}`,'roundedBox',[0.26,0.2,0.27,2,0.06],dark,{parent:elbow,at:[0,-0.49,0]});
    const thigh=bone(`Thigh${tag}`,{parent:hips,at:[s*0.24,-0.32,0]});
    const shin=bone(`Shin${tag}`,{parent:thigh,at:[0,-0.47,0]});
    mesh(`HipJoint${tag}`,'sphere',[0.15,16,12],dark,{parent:thigh});
    mesh(`LegArmor${tag}`,'roundedBox',[0.3,0.39,0.34,2,0.06],shell,{parent:thigh,at:[0,-0.24,0]});
    mesh(`Knee${tag}`,'sphere',[0.13,16,12],dark,{parent:shin});
    mesh(`BootShaft${tag}`,'roundedBox',[0.31,0.36,0.35,2,0.06],white,{parent:shin,at:[0,-0.23,0]});
    mesh(`Sole${tag}`,'roundedBox',[0.39,0.18,0.64,2,0.055],rubber,{parent:shin,at:[0,-0.47,0.12]});
  }
  // A real skinned flexible antenna, alongside the rigid bone-parented armor.
  const antennaRoot=bone('AntennaBase',{parent:neck,at:[0,0.48,0]});
  const antennaTip=bone('AntennaTip',{parent:antennaRoot,at:[0,0.25,0]});
  const g=geometry('cylinder',[0.025,0.035,0.5,8,8]);g.translate(0,0.25,0);
  const bones=[];rig.traverse(o=>{if(o.isBone)bones.push(o);});
  skin('AntennaFlex',g,dark,bones,v=>{const w=Math.min(1,Math.max(0,v.y/0.5));return [[bones.indexOf(antennaRoot),1-w],[bones.indexOf(antennaTip),w]];},{parent:antennaRoot});
  mesh('AntennaLamp','sphere',[0.06,16,12],glow,{parent:antennaTip,at:[0,0.25,0]});
  mesh('Backpack','roundedBox',[0.65,0.73,0.35,3,0.08],dark,{parent:spine,at:[0,0,-0.42]});
  const tau=Math.PI*2;
  clip('Idle',3,[sample(spine,'rotation',3,24,t=>[0,0,Math.sin(t*tau/3)*0.025]),sample(neck,'rotation',3,24,t=>[0,Math.sin(t*tau/3)*0.1,0]),sample(antennaTip,'rotation',3,24,t=>[0,0,Math.sin(t*tau/3)*0.2])]);
  const tracks=[sample(hips,'position',1.2,30,t=>[0,1.45+Math.sin(t*tau/1.2*2)*0.045,0])];
  for(const s of [-1,1]) {
    const tag=s===1?'L':'R', phase=s===1?0:Math.PI;
    tracks.push(sample(`Thigh${tag}`,'rotation',1.2,30,t=>[Math.sin(t*tau/1.2+phase)*0.48,0,0]));
    tracks.push(sample(`Shin${tag}`,'rotation',1.2,30,t=>[Math.max(0,-Math.sin(t*tau/1.2+phase))*0.65,0,0]));
    tracks.push(sample(`Arm${tag}`,'rotation',1.2,30,t=>[-Math.sin(t*tau/1.2+phase)*0.35,0,s*0.06]));
  }
  clip('Walk',1.2,tracks);
  clip('Wave',2.4,[sample('ArmL','rotation',2.4,30,t=>[0,0,2.2*Math.sin(Math.min(t/0.4,1,(2.4-t)/0.4)*Math.PI/2)]),sample('ForearmL','rotation',2.4,30,t=>[0,0,Math.sin(t*tau/0.6)*0.25]),sample(neck,'rotation',2.4,30,t=>[0,0,Math.sin(t*Math.PI/2.4)*-0.12])]);
  root.userData={author:'Codex Design',units:'meters',license:'User project'};
}
