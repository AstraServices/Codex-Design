/**
 * Portable keyframed locomotion for VENOM-8.
 * Three-segment limbs: two-bone analytic IK above a controlled distal segment.
 * All frames are baked to standard glTF TRS tracks; no runtime IK is required.
 */
export function addAnimations(k, rig) {
  const T = k.THREE;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const pulse = (t, a, b, c) => t < b ? smooth((t-a)/(b-a)) : 1-smooth((t-b)/(c-b));
  const v3 = a => new T.Vector3(...a);
  const quat = a => new T.Quaternion().setFromEuler(new T.Euler(...a, 'XYZ'));
  const identity = () => new T.Quaternion();
  const rootBase = rig.root.position.clone();
  const thoraxBase = rig.thorax.position.clone();
  const allBody = [rig.root, rig.thorax, rig.abdomen, rig.head, ...rig.mandibles, ...rig.palps];
  const legs = rig.legs.map(leg => {
    const p = leg.points.map(p => p.isVector3 ? p.clone() : v3(p));
    const a = p[1].clone().sub(p[0]);
    const b = p[2].clone().sub(p[1]);
    const c = p[3].clone().sub(p[2]);
    const axis = p[2].clone().sub(p[0]).normalize();
    const pole = a.clone().addScaledVector(axis, -a.dot(axis)).normalize();
    return {...leg, p, a, b, c, la:a.length(), lb:b.length(), pole};
  });
  let maximumReachClamp = 0;

  // Rest transforms are identity rotations. Construct local rotations from
  // target segment directions, retaining the original knee bend plane.
  function solveLeg(leg, foot, frame) {
    const rq = quat(frame.rootRotation);
    const tq = quat(frame.thoraxRotation);
    const bodyPosition = rootBase.clone().add(v3(frame.rootOffset));
    let target = foot.clone();
    if (!frame.localFeet) {
      target.add(rootBase).sub(bodyPosition).applyQuaternion(rq.clone().invert());
      target.sub(thoraxBase).applyQuaternion(tq.clone().invert());
    } else {
      target.sub(thoraxBase);
    }
    const hip = leg.hip.position.clone();
    const distal = leg.c.clone();
    if (frame.curl) {
      const curlRotation = quat([frame.curl * (leg.row < 2 ? -0.35 : 0.35), 0, -leg.side * frame.curl * 1.15]);
      distal.applyQuaternion(curlRotation);
    }
    const requestedAnkle = target.clone().sub(distal);
    const axis = requestedAnkle.clone().sub(hip);
    const requestDistance = axis.length();
    const distance = clamp(requestDistance, Math.abs(leg.la-leg.lb)+0.002, leg.la+leg.lb-0.002);
    maximumReachClamp = Math.max(maximumReachClamp, Math.abs(requestDistance-distance));
    axis.normalize();
    const ankle = hip.clone().addScaledVector(axis, distance);
    let pole = leg.pole.clone().addScaledVector(axis, -leg.pole.dot(axis));
    if (pole.lengthSq() < 1e-8) pole = new T.Vector3(0,1,0).addScaledVector(axis,-axis.y);
    pole.normalize();
    const along = (leg.la*leg.la-leg.lb*leg.lb+distance*distance)/(2*distance);
    const height = Math.sqrt(Math.max(0, leg.la*leg.la-along*along));
    const knee = hip.clone().addScaledVector(axis,along).addScaledVector(pole,height);
    const q0 = new T.Quaternion().setFromUnitVectors(leg.a.clone().normalize(),knee.clone().sub(hip).normalize());
    const q1 = new T.Quaternion().setFromUnitVectors(leg.b.clone().normalize(),ankle.clone().sub(knee).normalize());
    const q2 = new T.Quaternion().setFromUnitVectors(leg.c.clone().normalize(),distal.clone().normalize());
    return [q0, q0.clone().invert().multiply(q1), q1.clone().invert().multiply(q2), identity()];
  }

  function baseFrame(t) {
    return {
      rootOffset:[0,0,0], rootRotation:[0,0,0], thoraxRotation:[0,0,0],
      abdomenRotation:[0,0,0], headRotation:[0,0,0],
      jaw:0, palp:0, curl:0, localFeet:false,
      feet: legs.map(leg=>leg.p[3].clone())
    };
  }
  function idle(t, duration=4) {
    const f=baseFrame(t), phase=TAU*t/duration;
    f.rootOffset[1]=Math.sin(phase)*0.035;
    f.thoraxRotation[2]=Math.sin(phase)*0.009;
    f.abdomenRotation[0]=Math.sin(phase-0.4)*0.018;
    f.headRotation=[Math.sin(phase*2)*0.018,Math.sin(phase)*0.045,Math.sin(phase)*0.012];
    f.jaw=0.032+Math.sin(phase*2)*0.02;
    f.palp=Math.sin(phase*2)*0.055;
    return f;
  }
  function locomotion(t,duration,stride,lift,duty,isRun) {
    const f=baseFrame(t), phase=TAU*t/duration;
    f.rootOffset[1]=(isRun ? -0.10 : 0)+Math.cos(phase*2)*(isRun?0.06:0.025);
    f.thoraxRotation=[Math.sin(phase*2)*(isRun?0.035:0.012),Math.sin(phase)*0.018,Math.sin(phase)*(isRun?0.035:0.018)];
    f.abdomenRotation=[Math.sin(phase*2-0.65)*(isRun?0.065:0.028),Math.sin(phase-0.3)*0.025,0];
    f.headRotation=[isRun?-0.055:-0.012,-f.thoraxRotation[1]*0.55,-f.thoraxRotation[2]*0.6];
    f.jaw=isRun?0.13:0.055;
    f.palp=Math.sin(phase+0.7)*(isRun?0.1:0.05);
    f.feet=legs.map(leg=>{
      const group=(leg.row+(leg.side<0?1:0))%2;
      const p=((t/duration+group*0.5)%1+1)%1;
      const out=leg.p[3].clone();
      if(p<duty) {
        out.z+=stride*(0.5-p/duty);
      } else {
        const u=(p-duty)/(1-duty), s=smooth(u);
        out.z+=stride*(-0.5+s);
        out.y+=Math.sin(Math.PI*u)**1.3*lift;
        out.x+=leg.side*Math.sin(Math.PI*u)*(isRun?0.11:0.065);
      }
      return out;
    });
    return f;
  }
  // Body-local foot (thorax space) -> the root-relative space feet are authored in.
  function toWorld(frame,local) {
    const p=local.clone().sub(thoraxBase).applyQuaternion(quat(frame.thoraxRotation)).add(thoraxBase);
    return p.applyQuaternion(quat(frame.rootRotation)).add(v3(frame.rootOffset));
  }
  function sleeping(t,duration=4) {
    const f=baseFrame(t), phase=TAU*t/duration, breath=Math.sin(phase);
    // Huddled: belly near the ground, feet drawn in so the knees stand tall around the body.
    const dream=pulse(((t/duration)+1)%1,.55,.6,.68);
    f.rootOffset=[0,-0.78+breath*0.022,-0.06];
    f.thoraxRotation=[0.03,0,breath*0.006];
    f.abdomenRotation=[-0.12+breath*0.03,0,0];
    f.headRotation=[0.24+breath*0.01,0,0];
    f.jaw=-0.08;
    f.palp=-0.26+dream*0.08;
    f.feet=legs.map((leg,i)=>{
      const p=leg.p[3].clone();
      const tuck=leg.row===0?[0.55,0.62]:leg.row===3?[0.62,0.7]:[0.6,0.78];
      p.x*=tuck[0]; p.z*=tuck[1];
      if(leg.row===0)p.y+=0.12;
      if(i===1)p.y+=dream*0.14;
      return p;
    });
    return f;
  }
  function blendFrames(a,b,u) {
    const f=baseFrame(0);
    for(const field of ['rootOffset','rootRotation','thoraxRotation','abdomenRotation','headRotation'])
      f[field]=a[field].map((v,i)=>T.MathUtils.lerp(v,b[field][i],u));
    for(const field of ['jaw','palp','curl'])f[field]=T.MathUtils.lerp(a[field],b[field],u);
    f.feet=a.feet.map((v,i)=>v.clone().lerp(b.feet[i],u));
    return f;
  }
  function waking(t) {
    const a=sleeping(0), b=idle(0);
    const rise=smooth((t-.75)/1.0);
    const f=blendFrames(a,b,rise);
    const stir=pulse(t,.05,.25,.6), stretch=pulse(t,.35,.85,1.45), overshoot=pulse(t,1.35,1.65,2.2);
    const shake=pulse(t,1.6,1.8,2.3)*Math.sin(t*TAU*7);
    f.rootOffset[1]+=overshoot*0.07;
    f.rootOffset[2]+=stretch*0.06;
    f.thoraxRotation[2]+=shake*0.02;
    f.abdomenRotation[0]+=stretch*0.06-overshoot*0.04;
    f.abdomenRotation[2]+=shake*0.03;
    f.headRotation[0]+=-stretch*0.18-stir*0.05;
    f.headRotation[1]+=Math.sin(t*TAU*1.3)*stir*0.08;
    f.jaw+=stir*0.12+stretch*0.1;
    f.palp+=stir*0.3*Math.sin(t*TAU*4)+stretch*0.15;
    f.feet=legs.map((leg,i)=>{
      // Legs unfold row by row, rear first, so the body is pushed up rather than floated.
      const delay=[.95,.8,.7,.6][leg.row]+(leg.side<0?.05:0);
      const u=smooth((t-delay)/.75);
      const p=a.feet[i].clone().lerp(b.feet[i],u);
      p.y+=Math.sin(Math.PI*u)*0.32;
      if(leg.row===0){p.z+=stretch*0.55;p.y+=stretch*0.35;}
      if(i===0||i===4)p.y+=stir*0.12;
      return p;
    });
    return f;
  }
  function attack(t) {
    const f=baseFrame(t);
    const wind=pulse(t,0.05,0.44,0.80);
    const strike=pulse(t,0.45,0.64,1.08);
    const recoil=pulse(t,0.8,1.04,1.5);
    f.rootOffset=[0,wind*0.30-strike*0.12-recoil*0.035,wind*-0.12+strike*0.56];
    f.rootRotation=[-wind*0.12+strike*0.10,0,0];
    f.thoraxRotation=[-wind*0.07+strike*0.10,0,0];
    f.abdomenRotation=[wind*0.08-strike*0.16,0,0];
    f.headRotation=[-wind*0.11+strike*0.23,0,0];
    f.jaw=wind*0.42-strike*0.12+recoil*0.035;
    f.palp=wind*0.22-strike*0.18;
    f.feet=legs.map(leg=>{
      const p=leg.p[3].clone();
      const weight=leg.row===0?1:leg.row===1?0.27:0;
      p.y+=weight*(wind*1.0+strike*0.38);
      p.z+=weight*(-wind*0.50+strike*0.75);
      p.x-=leg.side*weight*strike*0.28;
      return p;
    });
    return f;
  }
  function threat(t) {
    const f=baseFrame(t), raise=pulse(t,0.12,0.65,2.4), tremble=Math.sin(t*TAU*5)*raise;
    f.rootOffset=[0,raise*0.18,raise*-0.10];
    f.rootRotation=[-raise*0.13,0,0];
    f.headRotation=[-raise*0.12,Math.sin(t*TAU)*raise*0.05,0];
    f.abdomenRotation=[raise*0.1,0,tremble*0.012];
    f.jaw=raise*0.36+tremble*0.025;
    f.palp=raise*0.27+tremble*0.05;
    f.feet=legs.map(leg=>{
      const p=leg.p[3].clone();
      if(leg.row===0) {p.y+=raise*1.32;p.x+=leg.side*raise*0.12;p.z-=raise*0.25;}
      return p;
    });
    return f;
  }
  function death(t) {
    const f=baseFrame(t);
    const hit=pulse(t,0,.12,.55), sway=pulse(t,.3,.65,1.15);
    const drop=smooth((t-.7)/.5), curl=smooth((t-1.0)/.9);
    const twitchEnv=pulse(t,1.5,1.7,2.6);
    f.rootOffset=[sway*0.14,hit*0.2-drop*0.98,-hit*0.22-drop*0.04];
    f.rootRotation=[-hit*0.24+drop*0.06,sway*0.08,sway*0.14+drop*0.07];
    f.thoraxRotation=[0,0,hit*Math.sin(t*TAU*6)*0.03];
    f.abdomenRotation=[hit*0.18-drop*0.16,0,sway*0.05+drop*0.04];
    f.headRotation=[-hit*0.2+drop*0.32,sway*0.1,drop*0.06];
    f.jaw=hit*0.42-drop*0.2+twitchEnv*Math.sin(t*TAU*5)*0.06;
    f.palp=hit*0.3-drop*0.32;
    f.curl=curl*0.85;
    f.feet=legs.map((leg,i)=>{
      const planted=leg.p[3].clone();
      if(leg.row===0){planted.y+=hit*0.9;planted.z+=hit*0.25;planted.x+=leg.side*hit*0.2;}
      // Legs on the side the body sways toward buckle first.
      if(leg.side<0)planted.x*=1+sway*0.12;
      const delay=leg.row*0.07+(leg.side>0?0:0.05);
      const u=smooth((t-1.0-delay)/.8);
      const local=new T.Vector3(leg.p[3].x*0.42,thoraxBase.y-0.35,leg.p[3].z*0.48);
      const curled=toWorld(f,local);
      const p=planted.lerp(curled,u);
      if(i===2||i===5)p.y+=twitchEnv*Math.max(0,Math.sin(t*TAU*4.5))*0.22;
      return p;
    });
    return f;
  }

  const specifications=[
    {name:'Idle',duration:4,loop:true,sample:t=>idle(t)},
    {name:'Walk',duration:1.2,loop:true,sample:t=>locomotion(t,1.2,.86,.27,.67,false)},
    {name:'Run',duration:.66,loop:true,sample:t=>locomotion(t,.66,1.36,.45,.54,true)},
    {name:'Attack',duration:1.5,loop:false,sample:attack},
    {name:'Sleep',duration:4,loop:true,sample:t=>sleeping(t)},
    {name:'Wake',duration:2.6,loop:false,sample:waking},
    {name:'Death',duration:2.8,loop:false,sample:death},
    {name:'Threat',duration:2.4,loop:false,sample:threat}
  ];
  const metadata=[];
  for(const spec of specifications) {
    const frames=Math.ceil(spec.duration*30), times=[];
    const positions=[], rotations=new Map();
    for(const bone of [...allBody,...legs.flatMap(leg=>[leg.hip,leg.knee,leg.ankle,leg.foot])])rotations.set(bone,[]);
    maximumReachClamp=0;
    for(let i=0;i<=frames;i++) {
      const t=spec.duration*i/frames;
      const frame=spec.sample(spec.loop&&i===frames?0:t);
      times.push(t);
      positions.push(rootBase.clone().add(v3(frame.rootOffset)).toArray());
      const bodyQuats=[quat(frame.rootRotation),quat(frame.thoraxRotation),quat(frame.abdomenRotation),quat(frame.headRotation)];
      allBody.slice(0,4).forEach((b,j)=>rotations.get(b).push(bodyQuats[j]));
      rig.mandibles.forEach((b,j)=>rotations.get(b).push(quat([frame.jaw*.10,(j===0?1:-1)*frame.jaw,0])));
      rig.palps.forEach((b,j)=>rotations.get(b).push(quat([frame.palp*.45,(j===0?1:-1)*frame.palp,(j===0?1:-1)*frame.palp*.25])));
      legs.forEach((leg,j)=>{
        const qs=solveLeg(leg,frame.feet[j],frame);
        [leg.hip,leg.knee,leg.ankle,leg.foot].forEach((bone,n)=>rotations.get(bone).push(qs[n]));
      });
    }
    const tracks=[k.track(rig.root,'position',times,positions)];
    for(const [bone,quaternions] of rotations) {
      for(let i=1;i<quaternions.length;i++)if(quaternions[i-1].dot(quaternions[i])<0){const q=quaternions[i];q.set(-q.x,-q.y,-q.z,-q.w);}
      tracks.push(k.track(bone,'quaternion',times,quaternions.map(q=>q.toArray())));
    }
    const clip=k.clip(spec.name,spec.duration,tracks);
    clip.userData={loop:spec.loop,rootMotion:'in-place',fps:30};
    metadata.push({name:spec.name,duration:spec.duration,loop:spec.loop,maximumIKReachClamp:+maximumReachClamp.toFixed(6)});
  }
  k.root.userData.animationSet={fps:30,axis:'+Z forward, +Y up',locomotion:'in-place',clips:metadata,
    notes:'Idle, Walk, Run, Sleep loop. Attack, Wake, Death, Threat play once. Blend into Sleep; Wake starts asleep. Locomotion uses alternating four-leg support groups with analytic foot placement.'};
  return metadata;
}

