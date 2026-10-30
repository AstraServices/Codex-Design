/** Authored boss animation library. Forward +Z, Y-up, scene units meters. */
export function addAnimations(k, rig) {
  const TAU = Math.PI * 2;
  const S = k.STUD;
  const spine = rig.spine || [];
  const bones = [...new Set(Object.values(rig).flat().filter(b => b?.isBone))];
  const rest = new Map(bones.map(b => [b, {
    p: b.position.toArray(), r: [b.rotation.x, b.rotation.y, b.rotation.z], s: b.scale.toArray()
  }]));
  const clamp = x => Math.max(0, Math.min(1, x));
  const ease = x => { x = clamp(x); return x*x*x*(x*(x*6-15)+10); };
  const segment = (t, a, b) => ease((t-a)/(b-a));
  const envelope = (t, a, b, c, d) => segment(t,a,b)*(1-segment(t,c,d));
  // Shape-preserving eased envelopes produce anticipation and settle with zero endpoint velocity.
  const curve = (t, keys) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i=1;i<keys.length;i++) if (t <= keys[i][0]) {
      const [a,va] = keys[i-1], [b,vb] = keys[i];
      return va+(vb-va)*ease((t-a)/(b-a));
    }
    return keys[keys.length-1][1];
  };
  function pose() {
    return new Map(bones.map(b => { const v=rest.get(b); return [b,{p:[...v.p],r:[...v.r],s:[...v.s]}]; }));
  }
  const turn = (p,b,x=0,y=0,z=0) => { if(b) {const v=p.get(b).r;v[0]+=x;v[1]+=y;v[2]+=z;} };
  const move = (p,b,x=0,y=0,z=0) => { if(b) {const v=p.get(b).p;v[0]+=x;v[1]+=y;v[2]+=z;} };
  function gills(p, phase, energy=1) {
    for(const [side, list] of [[-1,rig.gillsL || []],[1,rig.gillsR || []]]) {
      list.forEach((b,i) => {
        const breath = .5 + .5*Math.sin(phase-i*.16);
        turn(p,b,0,side*.018*energy*breath,0);
        // Roblox Bone.Transform is rigid: open the gill outward instead of scaling it.
        move(p,b,side*.04*S*energy*breath,.012*S*energy*breath,0);
      });
    }
  }
  function fins(p, phase, amp=1, flare=0) {
    const left = (rig.pecL?.position.x || -1) < 0 ? -1 : 1;
    const right = -left;
    for (const [b,tip,sg,lag] of [[rig.pecL,rig.pecTipL,left,.6],[rig.pecR,rig.pecTipR,right,.9]]) {
      turn(p,b,.022*amp*Math.sin(phase-lag),.015*amp*Math.cos(phase-lag),sg*(.035*amp*Math.sin(phase-lag)+flare));
      turn(p,tip,.012*amp*Math.sin(phase-lag-.45),.024*amp*Math.cos(phase-lag-.4),sg*(.035*amp*Math.sin(phase-lag-.6)+flare*.3));
    }
    turn(p,rig.dorsal,.007*amp*Math.cos(phase-.7),.028*amp*Math.sin(phase-.7),.013*amp*Math.sin(phase-.9));
    turn(p,rig.dorsal2,.01*amp*Math.cos(phase-1.2),.047*amp*Math.sin(phase-1.3),.018*amp*Math.sin(phase-1.4));
    turn(p,rig.pelvicL,.02*amp*Math.sin(phase-1.2),0,left*(.038*amp*Math.sin(phase-1.4)+flare*.65));
    turn(p,rig.pelvicR,.02*amp*Math.sin(phase-1.35),0,right*(.038*amp*Math.sin(phase-1.55)+flare*.65));
    turn(p,rig.anal,.012*amp*Math.sin(phase-1.4),.035*amp*Math.sin(phase-1.5),.01*amp*Math.sin(phase-1.8));
  }
  function swim(p, phase, strength=1) {
    // Absolute heading wave grows caudally. Local joint rotations are heading differences,
    // so a long chain never compounds eight large angles into an artificial corkscrew.
    let prev=0;
    spine.forEach((b,i) => {
      const s=(i+1)/Math.max(1,spine.length);
      const heading=strength*(.018+.135*Math.pow(s,1.65))*Math.sin(phase-s*2.65);
      turn(p,b,.004*strength*Math.sin(phase-s*1.8),heading-prev,0);
      prev=heading;
    });
    turn(p,rig.tail,.006*strength*Math.sin(phase-2.8),.105*strength*Math.sin(phase-3.1),.004*strength*Math.sin(phase-3.4));
    turn(p,rig.tailUpper,0,.034*strength*Math.sin(phase-3.55),.012*strength*Math.sin(phase-3.5));
    turn(p,rig.tailLower,0,.028*strength*Math.sin(phase-3.72),-.009*strength*Math.sin(phase-3.7));
    turn(p,rig.skull,.006*strength*Math.sin(phase-.35),-.014*strength*Math.sin(phase),.004*strength*Math.sin(phase-.4));
    fins(p,phase,strength);
    gills(p,phase*.5,strength);
  }
  function bend(p, amount, delayPhase=0) {
    // Rear links add progressively deeper curvature; head remains the leading mass.
    spine.forEach((b,i) => turn(p,b,0,amount*(.045+.055*i/spine.length),0));
    turn(p,rig.tail,0,amount*.13,0);
    turn(p,rig.tailUpper,0,amount*.035,0);
    turn(p,rig.tailLower,0,amount*.025,0);
  }
  const specs = [
    {name:'Idle Swim',duration:6,loop:true,fn(t,p){
      const ph=TAU*t/6;
      swim(p,ph,1);
      // Gill respiration is one full cycle per clip, as are every other looping channel.
      gills(p,ph,.65);
      move(p,rig.root,.035*S*Math.sin(ph),.14*S*Math.sin(ph-.35),.08*S*Math.sin(ph-.6));
      turn(p,rig.root,.012*Math.sin(ph-.3),.007*Math.sin(ph),.009*Math.sin(ph-.7));
      turn(p,rig.jaw,.018*(.5+.5*Math.sin(ph-.5)),0,0);
    }},
    {name:'Fast Swim',duration:2.4,loop:true,fn(t,p){
      const ph=TAU*t/2.4;
      swim(p,ph,2.05);
      move(p,rig.root,.04*S*Math.sin(ph),.075*S*Math.cos(2*ph),.16*S*Math.sin(2*ph-.5));
      turn(p,rig.root,-.035+.014*Math.sin(2*ph),.012*Math.sin(ph),.018*Math.sin(ph-.6));
      move(p,rig.skull,0,0,.16*S+.025*S*Math.cos(2*ph));
      turn(p,rig.jaw,-.055+.018*Math.cos(2*ph-.4),0,0);
      fins(p,ph,0,-.06);
      gills(p,ph,1.4);
    }},
    ...[[-1,'Turn Left'],[1,'Turn Right']].map(([sg,name]) => ({name,duration:4.8,loop:true,fn(t,p){
      const ph=TAU*t/4.8;
      swim(p,ph,1.3);
      const arc=.74+.26*Math.sin(ph-.25);
      bend(p,-sg*arc);
      turn(p,rig.skull,-.018,sg*(.10+.035*Math.sin(ph+.55)),-sg*.035);
      turn(p,rig.root,.008*Math.sin(ph-.2),sg*(.16+.045*Math.sin(ph+.3)),-sg*(.095+.025*Math.sin(ph)));
      move(p,rig.root,sg*.12*S*Math.sin(ph),.09*S*Math.sin(ph-.4),.06*S*Math.cos(ph));
      turn(p,rig.pecL,0,sg*.035,-sg*.065);
      turn(p,rig.pecR,0,sg*.035,-sg*.065);
      turn(p,rig.jaw,.018*Math.sin(ph-.4),0,0);
      gills(p,ph,.75);
    }})),
    {name:'Attack Bite',duration:3.2,loop:false,fn(t,p){
      const activity=envelope(t,0,.28,2.5,3.2);
      swim(p,TAU*t/1.6,activity*.58);
      const coil=curve(t,[[0,0],[.48,1],[.82,.8],[1.06,-.3],[1.5,-.12],[2.3,0],[3.2,0]]);
      const thrust=curve(t,[[0,0],[.55,-.5],[.82,-.58],[1.14,1.65],[1.45,1.55],[2.2,.45],[3.2,0]]);
      move(p,rig.root,0,.13*S*coil,thrust*S);
      turn(p,rig.root,-.045*coil,.025*coil,0);
      turn(p,rig.skull,-.105*coil,0,0);
      bend(p,.95*coil);
      const gape=curve(t,[[0,0],[.25,.05],[.72,.56],[.96,.67],[1.14,-.18],[1.28,-.13],[1.46,.08],[2.15,.03],[3.2,0]]);
      turn(p,rig.jaw,gape,0,0);
      const shake=envelope(t,1.19,1.33,1.72,2.15);
      turn(p,rig.skull,.025*shake*Math.sin(18*(t-1.2)),.15*shake*Math.sin(15*(t-1.2)),.03*shake*Math.sin(15*(t-1.2)-.3));
      fins(p,TAU*t/1.6,0,.14*activity);
      turn(p,rig.tail,0,.12*activity*Math.sin(TAU*t/1.6-.8),0);
    }},
    {name:'Roar Jaw Open',duration:4.8,loop:false,fn(t,p){
      const active=envelope(t,0,.55,3.6,4.8);
      swim(p,TAU*t/2.4,.42*active);
      const lift=curve(t,[[0,0],[.55,-.12],[1.25,.34],[2.8,.3],[3.8,.15],[4.8,0]]);
      move(p,rig.root,.08*S*active*Math.sin(t*2.1),lift*S,0);
      turn(p,rig.root,-.06*active,.025*active*Math.sin(t*2.1),.025*active*Math.sin(t*2.1-.4));
      const gape=curve(t,[[0,0],[.4,.03],[1.15,.74],[1.75,.72],[2.9,.68],[3.55,.58],[4.8,0]]);
      turn(p,rig.jaw,gape+.025*active*Math.sin(t*7.2),0,0);
      const thrash=envelope(t,.8,1.4,3.2,4.2);
      turn(p,rig.skull,-.095*active+.035*thrash*Math.sin(t*4.4),.13*thrash*Math.sin(t*3.1),.05*thrash*Math.sin(t*3.1-.4));
      bend(p,-.6*thrash*Math.sin(t*3.1-.65));
      fins(p,TAU*t/2.4,0,.22*active);
      gills(p,t*5,1.9*active);
    }},
    {name:'Hit Reaction',duration:1.8,loop:false,fn(t,p){
      const shock=curve(t,[[0,0],[.12,1],[.3,.72],[.66,-.24],[1.15,.06],[1.8,0]]);
      const follow=curve(t,[[0,0],[.14,.12],[.32,1],[.67,.25],[1.04,-.16],[1.8,0]]);
      move(p,rig.root,.22*S*shock,-.10*S*shock,-.35*S*shock);
      turn(p,rig.root,.065*shock,-.07*shock,-.08*shock);
      turn(p,rig.skull,.09*shock,.12*shock,.045*shock);
      turn(p,rig.jaw,.15*shock,0,0);
      bend(p,-1.1*follow);
      turn(p,rig.tail,0,.20*follow,0);
      fins(p,TAU*t/1.8,.6*envelope(t,0,.15,1,1.8),-.12*shock);
      gills(p,TAU*t/1.8,.4*envelope(t,0,.15,1,1.8));
    }},
    {name:'Death Roll',duration:6.8,loop:false,fn(t,p){
      const struggle=(1-segment(t,.55,3.8))*segment(t,0,.12);
      swim(p,TAU*t/1.5,struggle*1.15);
      const roll=curve(t,[[0,0],[.35,-.13],[1.1,.32],[2.6,1.65],[4.8,Math.PI+.065],[6.8,Math.PI]]);
      const sink=curve(t,[[0,0],[1,.12],[2.2,-.12],[4.5,-1.4],[6.8,-3.4]]);
      move(p,rig.root,.14*S*Math.sin(Math.PI*t/6.8),sink*S,-.25*S*segment(t,0,5));
      turn(p,rig.root,.08*segment(t,1,5),.04*struggle*Math.sin(t*4),roll);
      turn(p,rig.skull,.075*segment(t,2,5),.035*struggle*Math.sin(t*4+.5),0);
      turn(p,rig.jaw,curve(t,[[0,0],[.35,.17],[1.3,.3],[3.4,.16],[6.8,.24]]),0,0);
      const limp=segment(t,2.5,6);
      spine.forEach((b,i) => turn(p,b,.009*limp*(i+1)/spine.length,0,0));
      turn(p,rig.tail,.055*limp,0,0);
      turn(p,rig.tailUpper,.025*limp,.025*limp,0);
      turn(p,rig.tailLower,.025*limp,-.018*limp,0);
      fins(p,t*2,struggle*.4,-.20*limp);
      turn(p,rig.pecTipL,.05*limp,0,.07*limp);
      turn(p,rig.pecTipR,.05*limp,0,-.07*limp);
    }},
    {name:'Spawn Emerge',duration:4.4,loop:false,fn(t,p){
      const rise=curve(t,[[0,-4],[.6,-3.7],[1.4,-1.5],[2.1,.45],[2.8,.20],[4.4,0]]);
      move(p,rig.root,0,rise*S,curve(t,[[0,-1.5],[.6,-1.4],[1.5,-.5],[2.3,.4],[4.4,0]])*S);
      const active=envelope(t,0,.35,3.25,4.4);
      swim(p,TAU*t/2.2,active*.9);
      turn(p,rig.root,curve(t,[[0,-.18],[.8,-.23],[1.7,-.12],[2.5,.04],[4.4,0]]),0,.035*active*Math.sin(t*2.4));
      turn(p,rig.skull,-.05*active,0,0);
      const flick=curve(t,[[0,0],[.55,-.55],[1.08,.8],[1.55,-.32],[2.2,.1],[3.3,0],[4.4,0]]);
      bend(p,flick);
      turn(p,rig.tail,0,.34*flick,0);
      turn(p,rig.tailUpper,0,.06*flick,0);
      turn(p,rig.tailLower,0,.05*flick,0);
      turn(p,rig.jaw,curve(t,[[0,.03],[.7,.06],[1.7,.55],[2.12,.62],[2.35,-.17],[2.6,.035],[3.3,.02],[4.4,0]]),0,0);
      fins(p,t*2.8,0,.17*envelope(t,.5,1.3,2.4,3.8));
    }}
  ];
  // For loop respiration use the same integer-cycle phase as swimming, never half a loop.
  // swim()'s soft gill carrier is overridden below by deriving a full-period gill pose.
  for (const spec of specs) {
    const count=Math.ceil(spec.duration*30), times=[], poses=[];
    for(let i=0;i<=count;i++) {
      const t=spec.duration*i/count, p=pose();
      spec.fn(t,p);
      if(spec.loop) {
        for(const b of [...(rig.gillsL||[]),...(rig.gillsR||[])]) {
          const r=rest.get(b); p.set(b,{p:[...r.p],r:[...r.r],s:[...r.s]});
        }
        gills(p,TAU*t/spec.duration,spec.name==='Fast Swim'?1.7:1);
      }
      times.push(t);poses.push(p);
    }
    const tracks=[];
    for(const b of bones) {
      tracks.push(k.rotation(b,times,poses.map(p=>p.get(b).r)));
      tracks.push(k.track(b,'position',times,poses.map(p=>p.get(b).p)));

    }
    const clip=k.clip(spec.name,spec.duration,tracks);
    clip.userData={loop:spec.loop,sampleRate:30,description:spec.loop?'Seamless looping locomotion':'Authored boss action; play once with a short crossfade'};
  }
  return specs.map(({name,duration,loop})=>({name,duration,loop}));
}
