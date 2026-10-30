// STUD SHRINE: Roblox-style parts with stud surfaces, material presets, one icon pickup and live highlights.
// Meters, Y up, +Z forward. One stud = k.STUD (0.28 m); part sizes are whole studs.
export async function build(k) {
  const {parameters:p,STUD:S,part,group,mesh,robloxMaterial,iconBadge,highlight,clip,sample}=k;
  const shrine=group('Shrine');
  await part('Baseplate',[16*S,1*S,16*S],p.grass,{parent:shrine,at:[0,0.5*S,0],top:p.studStyle});
  await part('Step',[8*S,1*S,8*S],'#8a8f99',{parent:shrine,at:[0,1.5*S,0],surface:'Slate',top:p.studStyle});
  await part('Pedestal',[4*S,3*S,4*S],'#b7b9bf',{parent:shrine,at:[0,3.5*S,0],surface:'Marble',top:'smooth'});
  // Corner pillars: wood planks with neon caps.
  for(const [i,[x,z]] of [[-1,-1],[1,-1],[-1,1],[1,1]].entries()){
    await part(`Pillar${i}`,[1*S,6*S,1*S],'#7a4f2a',{parent:shrine,at:[x*6.5*S,4*S,z*6.5*S],surface:'WoodPlanks',top:'none',bottom:'none'});
    mesh(`PillarCap${i}`,'box',[1.2*S,0.4*S,1.2*S],robloxMaterial('Neon',{color:p.glow}),{parent:shrine,at:[x*6.5*S,7.2*S,z*6.5*S]});
  }
  // The pickup: an extruded coin icon from the bundled pack (the one icon this model needs).
  const pickup=group('Pickup',{parent:shrine,at:[0,7.2*S,0]});
  await iconBadge('Coin','Golden Coin',{size:p.coinSize,depth:0.14,bevel:0.02,metalness:0.35,roughness:0.35,parent:pickup});
  const gem=group('Gem',{parent:shrine,at:[0,5.6*S,0]});
  mesh('GemCore','icosahedron',[0.22,0],robloxMaterial('Glass',{color:'#7fe3ff'}),{parent:gem,scale:[1,1.5,1]});
  // Roblox Highlights (fill tint + silhouette outline): gold tint + white outline on the coin, occluded tint on the gem.
  highlight('Pickup',{FillColor:[255,204,51],FillTransparency:0.6,OutlineColor:[255,255,255],OutlineTransparency:0,DepthMode:'AlwaysOnTop'});
  highlight('Gem',{fillColor:'#38d6ff',fillTransparency:0.35,outlineColor:'#ffffff',depthMode:'Occluded',fillStyle:'fresnel'});
  // Edge Outlines (Roblox part-outline look): black lines on silhouette + hard edges, no fill. Baked as geometry on export.
  k.edges('Pedestal',{color:'#000000',thickness:2});
  k.edges('Step',{color:'#1b1b1b',thickness:1.5});
  for(let i=0;i<4;i++)k.edges(`Pillar${i}`,{color:'#000000',thickness:1.5});
  highlight('Step',{fillTransparency:1,outlineColor:p.glow,outlineTransparency:0.4,outlineWidth:2,depthMode:'Occluded',enabled:false});
  clip('Idle',4,[
    sample(pickup,'rotation',4,30,t=>[0,t/4*Math.PI*2,0]),
    sample(pickup,'position',4,30,t=>[0,7.2*S+Math.sin(t/4*Math.PI*2)*0.08,0]),
    sample(gem,'rotation',4,30,t=>[0,-t/4*Math.PI*2,0]),
  ]);
  clip('Collect',1.2,[
    sample(pickup,'position',1.2,30,t=>[0,7.2*S+Math.sin(Math.min(1,t/0.6)*Math.PI/2)*0.9,0]),
    sample(pickup,'scale',1.2,30,t=>{const s=t<0.6?1+t*0.4:Math.max(0.001,1.24*(1-(t-0.6)/0.6));return [s,s,s];}),
    sample(pickup,'rotation',1.2,30,t=>[0,t*Math.PI*4,0]),
  ]);
}
