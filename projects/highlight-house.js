// HIGHLIGHT HOUSE: a Roblox-style house wrapped in one Highlight (red fill + white outline), like a
// Highlight parented to a Model. Meters, Y up, +Z forward; sizes in whole studs (k.STUD = 0.28 m).
export async function build(k) {
  const {parameters:p,STUD:S,part,group,mesh,robloxMaterial,geometry,highlight,clip,sample}=k;
  await part('Baseplate',[24*S,1*S,20*S],'#8f9496',{at:[0,0.5*S,0],top:'studs'});
  const house=group('House',{at:[0,1*S,0]});
  await part('Floor',[16*S,1*S,12*S],'#7a5534',{parent:house,at:[0,0.5*S,0],surface:'WoodPlanks',top:'none'});
  const wallH=7*S,wallY=1*S+wallH/2,brick={surface:'Brick',top:'none',bottom:'none'};
  // Front wall with a door gap and two windows, built from studded-grid sized blocks.
  await part('WallFrontLeft',[6*S,wallH,1*S],'#c8c2b8',{parent:house,at:[-5*S,wallY,5.5*S],...brick});
  await part('WallFrontRight',[6*S,wallH,1*S],'#c8c2b8',{parent:house,at:[5*S,wallY,5.5*S],...brick});
  await part('WallFrontTop',[4*S,2*S,1*S],'#c8c2b8',{parent:house,at:[0,1*S+6*S,5.5*S],...brick});
  await part('WallBack',[16*S,wallH,1*S],'#c8c2b8',{parent:house,at:[0,wallY,-5.5*S],...brick});
  await part('WallLeft',[1*S,wallH,10*S],'#c8c2b8',{parent:house,at:[-7.5*S,wallY,0],...brick});
  await part('WallRight',[1*S,wallH,10*S],'#c8c2b8',{parent:house,at:[7.5*S,wallY,0],...brick});
  for(const [i,x] of [[0,-5*S],[1,5*S]]){
    mesh(`Window${i}`,'box',[2.4*S,2.4*S,0.2*S],robloxMaterial('Glass',{color:'#9fd8ff'}),{parent:house,at:[x,1*S+4*S,6.05*S]});
    mesh(`WindowFrame${i}`,'box',[2.8*S,0.3*S,0.4*S],robloxMaterial('Wood',{color:'#5c3b22'}),{parent:house,at:[x,1*S+2.7*S,6.1*S]});
  }
  // Door hinged on its left edge so it can swing open.
  const hinge=group('DoorHinge',{parent:house,at:[-2*S,1*S,5.6*S]});
  mesh('Door','box',[4*S,6*S,0.4*S],robloxMaterial('WoodPlanks',{color:'#6e4426'}),{parent:hinge,at:[2*S,3*S,0]});
  mesh('DoorKnob','sphere',[0.18*S,12,8],robloxMaterial('Metal',{color:'#d6b25e'}),{parent:hinge,at:[3.5*S,3*S,0.3*S]});
  // Gable roof: two sloped slabs plus triangular gable ends (extruded profile).
  const roofY=1*S+wallH,rise=4*S,half=9*S,slope=Math.atan2(rise,half),len=Math.hypot(rise,half);
  for(const [i,side] of [[0,-1],[1,1]]){
    await part(`Roof${i}`,[len,0.8*S,14*S],p.roof,{parent:house,at:[side*half/2,roofY+rise/2,0],rotate:[0,0,-side*slope],surface:'Slate',top:'none',bottom:'none'});
  }
  for(const [i,z] of [[0,5.5*S],[1,-5.5*S]]){
    const g=geometry('extrude',[[[-7.5*S,0],[7.5*S,0],[0,rise*0.95]],{depth:1*S,bevelEnabled:false}]);g.translate(0,0,-0.5*S);
    k.worldUV(g);mesh(`Gable${i}`,g,null,robloxMaterial('Brick',{color:'#c8c2b8'}),{parent:house,at:[0,roofY,z]});
  }
  await part('Chimney',[2*S,4*S,2*S],'#8b3a2f',{parent:house,at:[4.5*S,roofY+rise*0.75,-2*S],surface:'Brick',top:'smooth',bottom:'none'});
  await part('Step',[6*S,0.5*S,2*S],'#9a9a9a',{parent:house,at:[0,1.25*S,7*S],surface:'Concrete',top:'none'});

  // One Highlight on the whole house Model: Roblox defaults are red fill (0.5) + white outline.
  highlight('House',{FillColor:p.fill,FillTransparency:p.fillTransparency,OutlineColor:p.outline,OutlineTransparency:0,DepthMode:'AlwaysOnTop'});

  clip('DoorOpen',3,[sample(hinge,'rotation',3,30,t=>{const o=Math.sin(Math.min(1,t/1.2)*Math.PI/2)*(t<2.2?1:Math.cos((t-2.2)/0.8*Math.PI/2));return [0,-o*1.6,0];})]);
}
