// Harvest Revenant. Deterministic, reference-authored hero asset. Meters; Y up, +Z forward.
// All movements are baked to portable skeletal TRS tracks, including fingers and toes.
export async function build(k) {
  const T=k.THREE, TAU=Math.PI*2, clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
  const mix=(a,b,t)=>a+(b-a)*t, smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
  const bones=[], rests=new Map(), fingers={}, toes={}, limb={}, secondary=[];
  const rand=n=>{const x=Math.sin(n*127.1+31.7)*43758.5453;return x-Math.floor(x);};
  function bone(name,parent,at,rot=[0,0,0]) {const b=k.bone(name,{parent,at,rotate:rot});bones.push(b);rests.set(name,{p:at.slice(),r:rot.slice()});return b;}
  function mat(name,color,options={}){const m=k.material(color,options);m.name=name;return m;}
  const bark=k.pbrSurface({name:'Revenant_warped_bark',normal:1.3,
    height(u,v){const w=u+.009*Math.sin(v*7)+.004*Math.sin(v*17+u*12);const g=Math.sin(w*TAU*23+Math.sin(v*9)*.4),f=Math.sin(w*TAU*97+Math.sin(v*11));return .49+.12*g+.035*f+.014*Math.sin(v*13+u*29);},
    albedo(c){const t=clamp((c.h-.28)/.45),n=.008*Math.sin(c.v*17+c.u*29);return [.205+.13*t+n,.085+.065*t+n*.4,.039+.034*t];},
    roughness(c){return .66+.2*(1-c.h);}}, {size:1024,metalness:0,roughness:.8});bark.name='Bark_aged_chestnut_1K';
  const darkwood=mat('Wood_deep_fissures','#24130d',{roughness:.95,metalness:0});
  const ridge=mat('Wood_raised_fibres','#704029',{roughness:.73,metalness:0});
  const endgrain=k.pbrSurface({name:'Endgrain',normal:1.2,height(u,v){const x=u-.5,y=v-.5;return .5+.16*Math.sin(Math.hypot(x*1.1,y)*170+Math.sin(u*13)*2);},albedo(c){return [.25+c.h*.22,.115+c.h*.11,.05+c.h*.06];},roughness:()=>.83},{size:512});endgrain.name='Wood_cut_growth_rings';
  const pumpkin=k.pbrSurface({name:'Pumpkin_skin',normal:.28,height(u,v){return .5+.08*Math.sin(u*1700)*Math.sin(v*1321)+.12*Math.sin(u*71+Math.sin(v*21));},albedo(c){const n=.5+.5*Math.sin(c.u*65+Math.sin(c.v*29));return [.62+.18*c.h,.205+.09*c.h+.012*n,.022+.018*c.h];},roughness(c){return .37+.16*(1-c.h);}},{size:1024,metalness:0});pumpkin.name='Pumpkin_burnished_orange_1K';
  const pulp=mat('Carved_walls_warm_pulp','#d7680b',{roughness:.69,metalness:0});
  const ember=mat('Pumpkin_inner_ember','#ffb524',{emissive:'#ff870b',emissiveIntensity:k.parameters.ember??2.6,roughness:1,metalness:0});
  const gold=mat('Claws_antique_gold','#d99016',{metalness:.82,roughness:.26});
  const goldEdge=mat('Claws_polished_edges','#ffca4d',{metalness:.9,roughness:.2});
  const goldDark=mat('Claws_recessed_joints','#7f460c',{metalness:.75,roughness:.38});
  const vine=mat('Vine_deep_olive','#365813',{roughness:.47,metalness:0});
  const vineLight=mat('Vine_ridge_yellowgreen','#73882b',{roughness:.51,metalness:0});
  const thorn=mat('Thorn_dry_ivory','#c5ad76',{roughness:.65,metalness:0});
  const leafmat=k.pbrSurface({name:'Torn_leaf',normal:.6,height(u,v){return .5+.06*Math.sin(u*200+Math.sin(v*45))+.11*Math.sin((u+v*.38)*39);},albedo(c){const n=.5+.5*Math.sin(c.u*29+c.v*37);return [.24+.09*n,.30+.09*c.h,.045+.018*n];},roughness(c){return .66+.1*c.h;}},{size:1024,metalness:0,side:T.DoubleSide});leafmat.name='Leaf_olive_fibrous_1K';
  const leafEdge=mat('Leaf_veins_and_dry_edges','#91953b',{roughness:.85,metalness:0});
  const ivory=mat('Hip_carving_pale_wood','#d3b781',{roughness:.53,metalness:0});
  const rust=mat('Hip_seal_copper_band','#a64d24',{roughness:.45,metalness:.3});
  function mesh(name,g,m,parent,at,scale,rotate){return k.mesh(name,g,null,m,{parent,...(at?{at}:{}),...(scale?{scale}:{}),...(rotate?{rotate}:{})});}
  function ell(name,parent,p,s,m){return mesh(name,new T.SphereGeometry(1,32,20),m,parent,p,s);}
  function tube(name,parent,points,r,m,segments=48,rs=10){return mesh(name,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),segments,r,rs,false),m,parent);}
  function tapered(name,parent,a,b,r0,r1,m,rad=16){const av=new T.Vector3(...a),bv=new T.Vector3(...b),d=bv.clone().sub(av);const o=mesh(name,new T.CylinderGeometry(r1,r0,d.length(),rad,3),m,parent,av.clone().add(bv).multiplyScalar(.5).toArray());o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return o;}
  function spike(name,parent,base,tip,r,m=thorn){return tapered(name,parent,base,tip,r,.001,m,12);}
  function batch(name,parent,gs,m){if(!gs.length)return;const g=k.mergeGeometries(gs);gs.forEach(g=>g.dispose());return mesh(name,g,m,parent);}
  function tubeG(points,r,segments=24,rad=6){return new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),segments,r,rad,false);}
  function polygon(points){return new T.Shape(points.map(p=>new T.Vector2(...p)));}
  function leaf(name,parent,points,holes=[],z=.0){const s=polygon(points);for(const h of holes)s.holes.push(new T.Path(h.map(p=>new T.Vector2(...p))));const g=new T.ShapeGeometry(s,2);g.translate(0,0,z);return mesh(name,g,leafmat,parent);}

  const master=bone('Root',k.root,[0,0,0]);
  const hips=bone('Hips',master,[0,2.08,0]);
  const spine=bone('Spine',hips,[0,.31,0]);
  const chest=bone('Chest',spine,[0,.45,0]);
  const neck=bone('Neck',chest,[0,.40,0]);
  const head=bone('Head',neck,[0,.40,0]);head.scale.setScalar(.90);
  const stem0=bone('StemBase',head,[.015,.56,-.015]);
  const stem1=bone('StemMid',stem0,[.025,.17,0]);
  const stem2=bone('StemCurl',stem1,[.04,.18,0]);secondary.push(stem0,stem1,stem2);

  // Organic lathed logs with pinched joint ends, sculpted fluting and deep longitudinal cracks.
  function log(name,parent,length,rx,rz,seed=1,at=[0,0,0]){
    const rings=32,rad=48,g=new T.BufferGeometry(),pos=[],uv=[],idx=[];
    for(let j=0;j<=rings;j++){const v=j/rings,y=-length*v,bulge=.76+.24*Math.sin(Math.PI*v)**.45;
      for(let i=0;i<=rad;i++){const u=i/rad,a=u*TAU,flute=1+.035*Math.sin(a*9+seed)+.022*Math.sin(a*17+v*4)+.009*Math.sin(v*7+a*3);
        pos.push(Math.cos(a)*rx*bulge*flute+.013*Math.sin(v*5+seed)*Math.sin(Math.PI*v),y,Math.sin(a)*rz*bulge*flute);uv.push(u,v*length*1.25);}}
    for(let j=0;j<rings;j++)for(let i=0;i<rad;i++){const a=j*(rad+1)+i,b=a+rad+1;idx.push(a,a+1,b,b,a+1,b+1);}
    // Flat endgrain caps, hidden in the ball sockets during articulation.
    const gr=g.setAttribute('position',new T.Float32BufferAttribute(pos,3)).setAttribute('uv',new T.Float32BufferAttribute(uv,2));gr.setIndex(idx);gr.computeVertexNormals();mesh(name,gr,bark,parent,at);
    for(const [end,y] of [[0,0],[1,-length]]){const cap=new T.CircleGeometry(1,48);cap.rotateX(end?Math.PI/2:-Math.PI/2);mesh(name+'_Cut'+end,cap,endgrain,parent,[at[0],at[1]+y,at[2]],[rx*.76,1,rz*.76]);}
    const grooves=[],ridges=[];
    for(let f=0;f<19;f++){const a=TAU*f/19+rand(seed+f)*.09,v0=.06+rand(seed*3+f)*.28,v1=.72+rand(seed+f*8)*.23,pts=[];
      for(let j=0;j<13;j++){const v=mix(v0,v1,j/12),ang=a+.012*Math.sin(v*22+f),bulge=.76+.24*Math.sin(Math.PI*v)**.45;
        pts.push([at[0]+Math.cos(ang)*rx*bulge*1.025,at[1]-v*length,at[2]+Math.sin(ang)*rz*bulge*1.025]);}
      grooves.push(tubeG(pts,.0028+rand(f)*.0017,24,5));
      if(f%3===0)ridges.push(tubeG(pts.map(p=>[p[0]*1.008,p[1],p[2]*1.008]),.0017,24,5));
    }batch(name+'_BarkFissures',parent,grooves,darkwood);batch(name+'_Fibres',parent,ridges,ridge);
    const knotLines=[];
    const ky=-length*(.35+rand(seed)*.3),kx=(rand(seed+7)-.5)*rx*.6;
    for(let j=0;j<3;j++){const pts=[];for(let q=0;q<=60;q++){const a=q/60*TAU,rr=.017+j*.008;pts.push([at[0]+kx+Math.cos(a)*rr,at[1]+ky+Math.sin(a)*rr*1.6,at[2]+rz*.99+.001*j]);}knotLines.push(tubeG(pts,.0028,64,5));}
    batch(name+'_Growth_knot',parent,knotLines,darkwood);
  }
  ell('Pelvic_root_mass',hips,[0,-.08,0],[.31,.25,.205],bark);
  log('Lower_trunk',spine,.55,.285,.19,9,[0,.34,0]);
  log('Ribcage_wood',chest,.43,.43,.225,7,[0,.29,0]);
  ell('Sternum_knot',chest,[0,-.035,.222],[.084,.102,.024],endgrain);
  log('Neck_wood',neck,.22,.105,.11,4,[0,.16,0]);
  for(const s of [-1,1]){
    const tag=s<0?'R':'L';
    const clav=bone('Clavicle_'+tag,chest,[s*.32,.25,0]);
    const upper=bone('UpperArm_'+tag,clav,[s*.20,0,0],[0,0,s*.17]);
    const lower=bone('Forearm_'+tag,upper,[0,-.67,0]);
    const hand=bone('Hand_'+tag,lower,[0,-.65,0]);
    limb['arm'+tag]={clav,upper,lower,hand,s};
    ell('Shoulder_ball_'+tag,upper,[0,0,0],[.174,.179,.169],bark);
    ell('Elbow_socket_'+tag,lower,[0,.01,0],[.117,.126,.116],darkwood);
    ell('Elbow_knuckle_'+tag,lower,[0,0,.042],[.092,.10,.10],endgrain);
    log('Upper_arm_log_'+tag,upper,.59,.115,.12,12+(s+1),[0,-.055,0]);
    log('Forearm_log_'+tag,lower,.59,.107,.115,20+(s+1),[0,-.045,0]);
    // Lateral broken branch thorns are modeled, rather than painted.
    for(let i=0;i<4;i++){
      const y=-.13-i*.125;
      spike('Arm_thorn_'+tag+i,upper,[s*.104,y,.005],[s*(.18+rand(i+3)*.045),y+.035,.035],.031);
      spike('Forearm_thorn_'+tag+i,lower,[s*.093,y,-.005],[s*(.16+rand(i+5)*.06),y+.04,.025],.025);
    }
    // A brass cuff with an irregular, pointed crown lip.
    function cuff(name,parent,y,rx,rz,h){const n=64,positions=[],inds=[],uvs=[];
      for(let layer=0;layer<4;layer++)for(let i=0;i<=n;i++){const a=i/n*TAU,rr=layer>=2?.80:1;
        const top=(layer===1||layer===2),wave=Math.max(0,Math.cos(a*5))**8*.095;
        positions.push(Math.cos(a)*rx*rr,y+(top?h+wave:0),Math.sin(a)*rz*rr);uvs.push(i/n,layer/3);}
      for(let l=0;l<4;l++)for(let i=0;i<n;i++){const a=l*(n+1)+i,b=((l+1)%4)*(n+1)+i;inds.push(a,b,a+1,a+1,b,b+1);}
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));g.setIndex(inds);g.computeVertexNormals();mesh(name,g,gold,parent);}
    cuff('Crowned_wrist_'+tag,hand,.015,.127,.12,.14);
    ell('Gilded_palm_'+tag,hand,[0,-.115,0],[.119,.155,.061],gold);
    ell('Palm_back_plate_'+tag,hand,[0,-.10,-.052],[.106,.128,.035],goldEdge);
    // Five independently articulated digits, including an opposed thumb.
    fingers[tag]=[];
    for(let f=0;f<5;f++){
      const thumb=f===0,x=thumb?-s*.12:(f-2.5)*.061*s;
      const fb=bone('Finger_'+tag+f+'_A',hand,[x,thumb?-.105:-.235,thumb?.015:.012],thumb?[0,.24*s,-.75*s]:[.08,0,(f-2.5)*.075*s]);
      const len=thumb?.102:[0,.122,.14,.13,.106][f];
      const fm=bone('Finger_'+tag+f+'_B',fb,[0,-len,0]);
      const ft=bone('Finger_'+tag+f+'_C',fm,[0,-len*.72,0]);
      fingers[tag].push([fb,fm,ft]);
      for(const [j,b,L,r] of [[0,fb,len,.027],[1,fm,len*.72,.023],[2,ft,len*.69,.019]]){
        ell('Digit_joint_'+tag+f+j,b,[0,0,0],[r*1.16,r*1.15,r*1.18],j===1?goldDark:goldEdge);
        tapered('Digit_phalanx_'+tag+f+j,b,[0,-.012,0],[0,-L+.01,.007],r,r*.70,gold,18);
        if(j===2){const pts=[[0,-L*.45,.003],[0,-L*.85,.012],[0,-L*1.25,.044]];
          const g=new T.CylinderGeometry(r*.7,.001,L*1.25,16,4);const o=mesh('Digit_talon_'+tag+f,g,goldEdge,b,[0,-L*1.13,.029]);o.rotation.x=-.32;}
      }
      // Raised metacarpal tendon on the back of the hand.
      tube('Hand_tendon_'+tag+f,hand,[[x*.55,-.03,-.067],[x*.84,-.13,-.071],[x,-.23,-.04]],.011,goldEdge,16,8);
    }
    const thigh=bone('Thigh_'+tag,hips,[s*.22,-.14,0],[0,0,s*.065]);
    const shin=bone('Shin_'+tag,thigh,[0,-.84,0]);
    const foot=bone('Foot_'+tag,shin,[0,-.83,0]);
    limb['leg'+tag]={thigh,shin,foot,s};
    ell('Hip_socket_'+tag,thigh,[0,.01,0],[.16,.16,.151],darkwood);
    log('Thigh_wood_'+tag,thigh,.76,.151,.153,32+s,[0,-.04,0]);
    ell('Knee_socket_'+tag,shin,[0,0,0],[.145,.141,.14],darkwood);
    ell('Knee_wood_cap_'+tag,shin,[0,.012,.055],[.136,.126,.122],bark);
    log('Shin_wood_'+tag,shin,.77,.126,.13,41+s,[0,-.04,0]);
    cuff('Crowned_ankle_'+tag,foot,.012,.141,.14,.16);
    ell('Golden_heel_'+tag,foot,[0,-.04,-.015],[.146,.123,.19],gold);
    ell('Golden_instep_'+tag,foot,[0,-.075,.14],[.177,.085,.235],gold);
    toes[tag]=[];
    for(let f=0;f<4;f++){
      const x=(f-1.5)*.085,base=bone('Toe_'+tag+f+'_A',foot,[x,-.085,.285]);
      const tip=bone('Toe_'+tag+f+'_B',base,[0,0,.105]);toes[tag].push([base,tip]);
      ell('Toe_knuckle_'+tag+f,base,[0,0,.015],[.046,.043,.058],goldEdge);
      tapered('Toe_bone_'+tag+f,base,[0,0,.02],[0,-.006,.11],.034,.025,gold,18);
      ell('Toe_tipjoint_'+tag+f,tip,[0,0,0],[.029,.028,.034],goldDark);
      spike('Toe_talon_'+tag+f,tip,[0,0,.008],[0,-.075,.177-(Math.abs(f-1.5)*.015)],.027,goldEdge);
    }
    // Twisting green tendrils on the legs, each attached to its rigid wooden segment.
    for(const [n,b,L,r] of [['thigh',thigh,.72,.162],['shin',shin,.73,.137]]){
      for(let wrap=0;wrap<2;wrap++){
        const pts=[];for(let j=0;j<=72;j++){const t=j/72,a=t*TAU*(n==='shin'?1.10:.83)+wrap*Math.PI+s*.3;
          pts.push([Math.sin(a)*r,-.06-t*L,Math.cos(a)*r]);}
        tube('Leg_vine_'+tag+n+wrap,b,pts,wrap?.010:.016,wrap?vineLight:vine,100,10);
        for(let j=0;j<5;j++){const t=(j+.3)/5,a=t*TAU*(n==='shin'?1.1:.83)+wrap*Math.PI+s*.3;
          spike('Leg_vine_bud_'+tag+n+wrap+j,b,[Math.sin(a)*r,-.06-t*L,Math.cos(a)*r],[Math.sin(a)*(r+.031),-.045-t*L,Math.cos(a)*(r+.031)],.012,rust);}
      }
    }
  }
  // Woven, asymmetric vine girdle with dangling curls and dry leaf knots.
  for(let i=0;i<4;i++){
    const pts=[];for(let j=0;j<=110;j++){const a=j/110*TAU*1.05+i*.68;pts.push([Math.sin(a)*(.327+i*.008),-.16+i*.035+.052*Math.cos(a+.7*i),Math.cos(a)*(.23+i*.009)]);}
    tube('Woven_waist_vine_'+i,hips,pts,.017-(i%2)*.004,i%2?vineLight:vine,128,10);
    for(let t=0;t<8;t++){const a=t/8*TAU+i*.7;spike('Belt_thorn_'+i+t,hips,[Math.sin(a)*.35,-.15+i*.035,Math.cos(a)*.25],[Math.sin(a)*.388,-.12+i*.035,Math.cos(a)*.284],.013,rust);}
  }
  tube('Left_hip_loop',hips,[[-.28,-.18,.12],[-.44,.04,.13],[-.43,.29,.10],[-.33,.36,.08],[-.31,.20,.16],[-.37,.07,.23],[-.25,-.12,.27]],.022,vine,100,12);
  tube('Left_hip_loop_ridge',hips,[[-.31,-.19,.14],[-.48,.04,.10],[-.47,.31,.09],[-.35,.38,.08],[-.30,.26,.1]],.008,vineLight,64,8);
  // Pale, scalloped hip seal: the conspicuous cream/copper accessory in the concept.
  const seal=k.group('Carved_hip_seal',{parent:hips,at:[.355,-.025,.035],rotate:[0,-.8,-.13]});
  const outline=[];for(let i=0;i<72;i++){const a=i/72*TAU,r=.235*(1+.10*Math.cos(a*8));outline.push([Math.cos(a)*r,Math.sin(a)*r*1.18]);}
  const sealGeo=new T.ExtrudeGeometry(polygon(outline),{depth:.055,bevelEnabled:true,bevelSize:.025,bevelThickness:.022,bevelSegments:3,steps:1});sealGeo.rotateY(Math.PI/2);mesh('Seal_carved_scallops',sealGeo,ivory,seal);
  for(const [n,r,depth,x,m] of [['Rim',.179,.045,.085,rust],['Core',.148,.058,.117,ivory],['Inset',.116,.012,.152,endgrain]]){
    const g=new T.CylinderGeometry(r,r,depth,64,2);g.rotateZ(Math.PI/2);mesh('Seal_'+n,g,m,seal,[x,0,0]);}
  // Torn front leaf bib. Slashes and missing perimeter chunks are actual topology.
  const bibOutline=[[-.43,.27],[-.32,.245],[-.29,.31],[-.20,.29],[-.12,.235],[-.015,.25],[.045,.29],[.12,.265],[.19,.29],[.26,.34],[.36,.33],[.40,.26],[.43,.20],[.395,.125],[.405,.04],[.36,.06],[.34,-.045],[.285,-.08],[.29,-.16],[.22,-.13],[.16,-.21],[.105,-.19],[.065,-.22],[-.015,-.18],[-.075,-.21],[-.10,-.17],[-.16,-.20],[-.205,-.15],[-.25,-.22],[-.27,-.10],[-.31,-.12],[-.335,-.045],[-.385,-.05],[-.36,.035],[-.42,.04],[-.395,.11],[-.45,.16]];
  const holes=[ [[-.33,.09],[-.20,.13],[.09,.19],[-.04,.12],[-.20,.05]], [[-.30,-.035],[-.18,.015],[.03,.115],[-.065,.035],[-.22,-.045]], [[-.22,-.10],[-.10,-.04],[.16,.135],[.07,.04],[-.12,-.11]], [[.24,.18],[.29,.19],[.27,.105],[.25,.10]], [[.20,-.04],[.235,-.015],[.25,-.07],[.21,-.095]] ];
  function mantle(name,back=false){
    const shape=polygon(bibOutline);for(const h of holes)shape.holes.push(new T.Path(h.map(p=>new T.Vector2(...p))));
    let g=new T.ShapeGeometry(shape,1);
    for(let pass=0;pass<3;pass++){const a=g.attributes.position,ix=g.index,ps=[],ixs=[];for(let i=0;i<ix.count;i+=3){const [a0,b,c]=[0,1,2].map(j=>[a.getX(ix.getX(i+j)),a.getY(ix.getX(i+j))]),mid=(p,q)=>[(p[0]+q[0])/2,(p[1]+q[1])/2],ab=mid(a0,b),bc=mid(b,c),ca=mid(c,a0);for(const tri of [[a0,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])for(const [x,y] of tri){ixs.push(ps.length/3);ps.push(x,y,0);}}g.dispose();g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(ps,3));g.setAttribute('uv',new T.Float32BufferAttribute(ps.flatMap((v,i)=>i%3===2?[]:[v]),2));g.setIndex(ixs);}
    const p=g.attributes.position;
    for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i);p.setZ(i,(back?-1:1)*(.237-.11*(x/.47)**2+.018*Math.sin(x*11+y*8)));}g.computeVertexNormals();
    k.skin(name,g,leafmat,bones,v=>{const w=smooth((v.y+.2)/.4);return [[bones.indexOf(spine),(1-w)*.28],[bones.indexOf(chest),.72+w*.28]];},{parent:chest});
    const curves=[];for(const side of [-1,1])for(let i=0;i<5;i++){
      const y=-.12+i*.072,pts=[];for(let j=0;j<=12;j++){const t=j/12,x=side*t*(.29+i*.015),yy=y+t*.12;pts.push([x,yy,(back?-1:1)*(.241-.11*(x/.47)**2+.018*Math.sin(x*11+yy*8))]);}
      curves.push(tubeG(pts,.0022,18,5));}
    batch(name+'_Veins',chest,curves,leafEdge);
    // Ragged, small rolled edges on torn strips.
    const edgeCurves=[];for(let h=0;h<3;h++){const pts=holes[h].slice(0,3).map(([x,y])=>[x,y,(back?-1:1)*(.240-.11*(x/.47)**2+.018*Math.sin(x*11+y*8))]);edgeCurves.push(tubeG(pts,.003,24,6));}
    batch(name+'_Tear_rims',chest,edgeCurves,leafEdge);
  }mantle('Torn_leaf_bib');mantle('Back_leaf_mantle',true);
  // Small shoulder leaf straps, independently articulated for secondary motion.
  for(const s of [-1,1]){const b=bone('LeafTassel_'+(s<0?'R':'L'),chest,[s*.39,.28,0]);secondary.push(b);
    const pts=[[-.065,0],[-.045,.09],[.025,.11],[.065,.025],[.045,-.15],[0,-.21],[-.025,-.12]];
    const g=new T.ShapeGeometry(polygon(pts));g.rotateX(Math.PI/2);mesh('Shoulder_leaf_'+s,g,leafmat,b,[0,0,.02]);}

  // Pumpkin shell: topology in longitude / latitude, with true carved face openings.
  function point(u,v,inset=0){const c=Math.cos(v),r=(1+.068*Math.cos(u*10)+.016*Math.cos(u*20))*(1-.055*Math.sin(v));return [(.665-inset)*c*Math.sin(u)*r,.565*Math.sin(v),(.575-inset)*c*Math.cos(u)*r];}
  const eyeL=[[-.51,.20],[-.42,.16],[-.17,.015],[-.12,.005],[-.18,.115],[-.35,.22],[-.50,.26]];
  const eyeR=eyeL.map(([x,y])=>[-x,y]).reverse();
  const mouth=[[-.49,-.11],[-.40,-.19],[-.34,-.175],[-.30,-.225],[-.245,-.21],[-.21,-.25],[-.15,-.23],[-.12,-.275],[-.06,-.25],[0,-.29],[.05,-.25],[.11,-.26],[.15,-.21],[.21,-.225],[.245,-.18],[.31,-.19],[.35,-.125],[.405,-.10],[.475,-.015],[.43,-.19],[.365,-.28],[.27,-.335],[.20,-.33],[.16,-.375],[.09,-.35],[.04,-.38],[-.03,-.36],[-.08,-.39],[-.14,-.35],[-.20,-.36],[-.245,-.31],[-.31,-.32],[-.38,-.26],[-.425,-.24]];
  const nose=[[-.026,-.055],[.012,-.015],[.038,-.083]];
  function uvFace([x,y]){const v=Math.asin(y/.565),u=Math.asin(clamp(x/(.665*Math.cos(v)),-.99,.99));return [u,v];}
  const cuts=[eyeL,eyeR,mouth,nose].map(p=>p.map(uvFace));
  const shape=polygon([[-Math.PI,-Math.PI/2+.014],[Math.PI,-Math.PI/2+.014],[Math.PI,Math.PI/2-.014],[-Math.PI,Math.PI/2-.014]]);
  cuts.forEach(p=>shape.holes.push(new T.Path(p.map(p=>new T.Vector2(...p)))));
  const flat=new T.ShapeGeometry(shape);let triangles=[];const pa=flat.attributes.position,ind=flat.index;
  for(let i=0;i<ind.count;i+=3)triangles.push([0,1,2].map(j=>[pa.getX(ind.getX(i+j)),pa.getY(ind.getX(i+j))]));
  // Adaptive, conforming midpoint subdivision. The surface is smooth between lobe creases.
  for(let iter=0;iter<6;iter++){const next=[];for(const tri of triangles){const [a,b,c]=tri,mid=(p,q)=>[(p[0]+q[0])/2,(p[1]+q[1])/2];
      const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);next.push([a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]);}triangles=next;}
  const ps=[],uvs=[],ns=[],is=[],map=new Map();
  for(const tri of triangles){const ids=tri.map(([u,v])=>{const key=u.toFixed(7)+','+v.toFixed(7);if(map.has(key))return map.get(key);const id=ps.length/3;map.set(key,id);ps.push(...point(u,v));uvs.push((u+Math.PI)/TAU,(v+Math.PI/2)/Math.PI);
    const pu=new T.Vector3(...point(u+.0001,v)).sub(new T.Vector3(...point(u-.0001,v))),pv=new T.Vector3(...point(u,v+.0001)).sub(new T.Vector3(...point(u,v-.0001)));ns.push(...pu.cross(pv).normalize().toArray());return id;});is.push(...ids);}
  const shell=new T.BufferGeometry();shell.setAttribute('position',new T.Float32BufferAttribute(ps,3));shell.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));shell.setAttribute('normal',new T.Float32BufferAttribute(ns,3));shell.setIndex(is);mesh('Pumpkin_carved_ribbed_shell',shell,pumpkin,head);
  // Each cut has a thick flesh wall, then an inset ember surface: side views retain the carving depth.
  cuts.forEach((poly,n)=>{const positions=[],uv=[],indices=[];
    for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];const steps=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/.025);
      for(let j=0;j<steps;j++){const t=j/steps,u=mix(a[0],b[0],t),v=mix(a[1],b[1],t);positions.push(...point(u,v,0),...point(u,v,.053));uv.push(t,0,t,1);}}
    const count=positions.length/6;for(let i=0;i<count;i++){const a=i*2,b=((i+1)%count)*2;indices.push(a,b,a+1,b,b+1,a+1);}
    const wall=new T.BufferGeometry();wall.setAttribute('position',new T.Float32BufferAttribute(positions,3));wall.setAttribute('uv',new T.Float32BufferAttribute(uv,2));wall.setIndex(indices);wall.computeVertexNormals();const w=mesh('Face_carving_wall_'+n,wall,pulp,head);w.material.side=T.DoubleSide;
    let g=new T.ShapeGeometry(polygon(poly));
    for(let pass=0;pass<4;pass++){const a=g.attributes.position,ix=g.index,vs=[],uvs=[];for(let i=0;i<ix.count;i+=3){const tri=[0,1,2].map(j=>[a.getX(ix.getX(i+j)),a.getY(ix.getX(i+j))]),[a0,b,c]=tri,mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2],ab=mid(a0,b),bc=mid(b,c),ca=mid(c,a0);for(const sub of [[a0,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])for(const p of sub){vs.push(p[0],p[1],0);uvs.push(p[0],p[1]);}}g.dispose();g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vs,3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));g.setIndex(vs.map((_,i)=>i).filter(i=>i<vs.length/3));}
    const a=g.attributes.position;for(let i=0;i<a.count;i++)a.setXYZ(i,...point(a.getX(i),a.getY(i),.059));g.computeVertexNormals();const fire=mesh('Inset_ember_'+n,g,ember,head);fire.castShadow=false;fire.receiveShadow=false;
  });
  ell('Pumpkin_bottom_navel',head,[0,-.555,0],[.104,.028,.098],pulp);
  ell('Stem_root_calyx',head,[.0,.54,-.01],[.14,.065,.12],bark);
  // Flexible 3-bone stalk with ring loops and a curled green tip.
  const stalkPts=[[0,0,0],[.015,.10,-.01],[.035,.20,-.015],[.012,.28,-.005],[-.005,.34,0],[.045,.41,0]];
  const stalkGeo=tubeG(stalkPts,.047,72,14);
  k.skin('Flexible_pumpkin_stalk',stalkGeo,bark,bones,v=>{const y=clamp(v.y/ .36)*2,i=Math.min(1,Math.floor(y)),w=y-i;return [[bones.indexOf([stem0,stem1,stem2][i]),1-w],[bones.indexOf([stem0,stem1,stem2][i+1]),w]];},{parent:stem0});
  const curl=[];for(let i=0;i<=100;i++){const t=i/100,a=t*TAU*1.42-1.30,r=mix(.17,.012,t);curl.push([.09+Math.cos(a)*r,.12+Math.sin(a)*r,0]);}
  tube('Spiral_green_stem_tip',stem2,curl,.023,vine,144,12);
  tube('Spiral_stem_highlight_rib',stem2,curl.map(p=>[p[0],p[1],.020]),.006,vineLight,144,8);
  tube('Stalk_dry_fibre',stem1,[[-.028,-.06,.027],[-.043,.06,.03],[-.03,.13,.026],[-.066,.19,.023]],.009,ivory,32,7);
  leaf('Stem_tip_leaf',stem2,[[.16,.035],[.21,.075],[.24,.025],[.205,-.01]],[],.008);
  for(let i=0;i<6;i++){const a=i*TAU/6;spike('Calyx_spur_'+i,head,[Math.sin(a)*.07,.54,Math.cos(a)*.07],[Math.sin(a)*.17,.51,Math.cos(a)*.15],.021,vine);}

  // Animation system: every clip carries a complete pose, preventing stale finger / limb poses on transitions.
  // Foot IK is solved analytically at authoring time for locomotion; the resulting rotations export as normal keys.
  const eventTable={};
  function blank(){const p={r:{},hips:[0,0,0],root:[0,0,0]};return p;}
  function r(p,b,x=0,y=0,z=0){p.r[typeof b==='string'?b:b.name]=[x,y,z];}
  function curlF(p,side,c=.2,spread=0){for(let f=0;f<5;f++){const bs=fingers[side][f];r(p,bs[0],c*.42,0,(f-2)*spread);r(p,bs[1],c*.85,0,0);r(p,bs[2],c*.65,0,0);}}
  function idle(p,t,combat=false){const a=TAU*t/3.6;r(p,spine,.018*Math.sin(a),.035*Math.sin(a*.5),.018*Math.sin(a));r(p,chest,.024*Math.sin(a+.4),0,.012*Math.cos(a));r(p,head,.015*Math.sin(a-.4),.065*Math.sin(a*.5),.028*Math.cos(a));
    for(const side of ['L','R']){const A=limb['arm'+side];r(p,A.upper,combat?-.22: .022*Math.sin(a+.7),combat?A.s*.10:0,combat?A.s*.08:.025*A.s*Math.sin(a));r(p,A.lower,combat?-.62:-.10-.03*Math.cos(a));r(p,A.hand,.05*Math.sin(a+.8),0,.04*A.s);curlF(p,side,combat?.65:.24+.05*Math.sin(a+.6));}
    p.hips[1]=.008*Math.sin(a);}
  function secondaries(p,t,intensity=.04){r(p,stem0,Math.sin(t*3.5)*intensity,0,Math.cos(t*3.2)*intensity*.5);r(p,stem1,Math.sin(t*3.5-.5)*intensity,0,Math.sin(t*3.2-.4)*intensity);r(p,stem2,0,0,Math.sin(t*3.5-1)*intensity*1.1);
    for(const s of [-1,1])r(p,'LeafTassel_'+(s<0?'R':'L'),Math.sin(t*4+s)*intensity*2,0,Math.cos(t*3+s)*intensity);}
  function addClip(name,duration,pose,{loop=false,events=[]}={}){
    const samples=[],n=Math.ceil(duration*30);for(let i=0;i<=n;i++){const t=duration*i/n,p=blank();pose(p,t,t/duration);samples.push(p);}
    if(loop)for(let i=Math.floor(n*.88);i<=n;i++){const w=smooth((i/n-.88)/.12),p=samples[i],first=samples[0];for(const b of bones){const a=p.r[b.name]||[0,0,0],f=first.r[b.name]||[0,0,0];p.r[b.name]=a.map((x,j)=>mix(x,f[j],w));}for(const key of ['hips','root'])p[key]=p[key].map((x,j)=>mix(x,first[key][j],w));}
    const tracks=[];
    for(const b of bones){const rest=rests.get(b.name),vals=samples.map(p=>{const a=p.r[b.name]||[0,0,0];return rest.r.map((v,i)=>v+a[i]);});tracks.push(k.rotation(b,samples.map((_,i)=>duration*i/n),vals));}
    for(const [b,key] of [[hips,'hips'],[master,'root']])tracks.push(k.track(b,'position',samples.map((_,i)=>duration*i/n),samples.map(p=>p[key].map((v,j)=>v+rests.get(b.name).p[j]))));
    const clip=k.clip(name,duration,tracks);clip.userData={loop,events};eventTable[name]={duration,loop,events};
  }
  addClip('Idle',3.6,(p,t,u)=>{idle(p,t);secondaries(p,t); // integer harmonics close the loop
    r(p,head,.015*Math.sin(u*TAU),.065*Math.sin(u*TAU),.028*Math.cos(u*TAU));
    r(p,spine,.018*Math.sin(u*TAU),.035*Math.sin(u*TAU),.018*Math.sin(u*TAU));
    for(const b of secondary)r(p,b,.025*Math.sin(u*TAU),0,.025*Math.cos(u*TAU));},{loop:true});
  addClip('Combat_Idle',2.4,(p,t,u)=>{idle(p,u*3.6,true);secondaries(p,u*TAU/3.5);r(p,chest,.05,.06*Math.sin(u*TAU),0);r(p,head,-.04,-.08,0);},{loop:true});
  function gait(name,duration,speed,stride,dir=1){addClip(name,duration,(p,t,u)=>{
    const phase=u*TAU,run=speed>1.4;
    p.hips[1]=run?.028+.065*Math.cos(phase*2):.012+.022*Math.cos(phase*2);
    r(p,spine,run?.17:.035,.045*Math.sin(phase),.025*Math.sin(phase));r(p,chest,run?-.035:0,-.09*Math.sin(phase),0);r(p,head,run?-.12:-.025,.025*Math.sin(phase),-.025*Math.sin(phase));
    for(const side of ['L','R']){const A=limb['arm'+side],L=limb['leg'+side],q=phase+(side==='L'?0:Math.PI),s=Math.sin(q),swing=Math.max(0,s),stance=Math.max(0,-s);
      // Analytic two-link solution to an in-place sagittal foot trajectory.
      const footZ=-Math.cos(q)*stride*dir,footY=-1.64+(run?.34:.15)*swing+p.hips[1]*-1;
      const len=.835,d=Math.min(1.668,Math.hypot(footY,footZ)),knee=Math.PI-Math.acos(clamp((2*len*len-d*d)/(2*len*len),-1,1));
      const hip=Math.atan2(-footZ,-footY)-knee*.5;
      r(p,L.thigh,hip,0,-L.s*.018*Math.cos(q));r(p,L.shin,knee);r(p,L.foot,-hip-knee+(run?.36:.19)*stance);
      r(p,A.upper,Math.cos(q)*stride*(run?1.8:.95),0,A.s*(run?.09:.015));r(p,A.lower,run?-.9-.28*s:-.20-.09*s);r(p,A.hand,-.06,0,0);curlF(p,side,run?.55:.24);
      for(const [j,ts] of toes[side].entries()){r(p,ts[0],-(run?.5:.25)*stance);r(p,ts[1],.2*stance);}
    }
    for(let i=0;i<secondary.length;i++)r(p,secondary[i],Math.sin(phase*2-i*.7)*(run?.11:.035),0,Math.cos(phase-i*.7)*.035);
  },{loop:true,events:[{time:0,event:'foot_L'},{time:duration/2,event:'foot_R'}]});}
  gait('Walk',1.2,1,.27);gait('Run',.72,2,.48);gait('Sprint',.56,3,.59);gait('Walk_Backward',1.4,.8,.22,-1);
  for(const s of [-1,1])addClip(s<0?'Strafe_Right':'Strafe_Left',1.0,(p,t,u)=>{idle(p,u*3.6,true);const a=u*TAU;
    for(const side of ['L','R']){const L=limb['leg'+side],q=a+(side==='L'?0:Math.PI);r(p,L.thigh,.10,0,s*.28*Math.sin(q));r(p,L.shin,.15+.20*Math.max(0,Math.sin(q)));r(p,L.foot,-.17,0,-s*.18*Math.sin(q));}p.hips[1]=.02*Math.cos(a*2);r(p,chest,0,-s*.18,.035*Math.sin(a));},{loop:true});
  addClip('Jump_Start',.42,(p,t,u)=>{idle(p,0,true);const c=Math.sin(u*Math.PI),push=smooth((u-.65)/.35);p.hips[1]=-.27*c+.12*push;r(p,spine,.28*c);for(const side of ['L','R']){const L=limb['leg'+side],A=limb['arm'+side];r(p,L.thigh,-.52*c);r(p,L.shin,1.04*c);r(p,L.foot,-.52*c);r(p,A.upper,.5*c-1.1*push);r(p,A.lower,-.6*c);}secondaries(p,t,.08);},{events:[{time:.35,event:'takeoff'}]});
  addClip('Jump_Loop',.8,(p,t,u)=>{idle(p,0,true);const a=u*TAU;for(const side of ['L','R']){const L=limb['leg'+side],A=limb['arm'+side];r(p,L.thigh,-.45+.04*Math.sin(a));r(p,L.shin,.85+.06*Math.sin(a));r(p,L.foot,-.32);r(p,A.upper,-.7,0,A.s*.22);r(p,A.lower,-.6);}p.hips[1]=.02*Math.sin(a);r(p,spine,.08);for(const b of secondary)r(p,b,.06*Math.sin(a),0,0);},{loop:true});
  addClip('Jump_Full',1.35,(p,t,u)=>{const take=smooth(u/.20),land=smooth((u-.78)/.22),flight=Math.sin(clamp((u-.18)/.62)*Math.PI);p.root[1]=1.05*flight;p.hips[1]=-.23*Math.sin(clamp(u/.18)*Math.PI)-.26*Math.sin(land*Math.PI);
    r(p,spine,.18*(1-flight));for(const side of ['L','R']){const L=limb['leg'+side],A=limb['arm'+side],c=.55*flight+.45*Math.sin(land*Math.PI);r(p,L.thigh,-c);r(p,L.shin,c*1.8);r(p,L.foot,-c*.8);r(p,A.upper,-.85*flight+.32*Math.sin(land*Math.PI),0,A.s*.14*flight);r(p,A.lower,-.5*flight);curlF(p,side,.3);}secondaries(p,t,.12);},{events:[{time:.24,event:'takeoff'},{time:1.06,event:'land'}]});
  addClip('Fall',1.0,(p,t,u)=>{idle(p,0);const a=u*TAU;r(p,spine,-.1);for(const side of ['L','R']){const A=limb['arm'+side],L=limb['leg'+side];r(p,A.upper,-.45,0,A.s*.62);r(p,A.lower,-.48);r(p,L.thigh,-.14+.04*Math.sin(a));r(p,L.shin,.34);r(p,L.foot,.20);curlF(p,side,.12);}for(const b of secondary)r(p,b,.1*Math.sin(a),0,0);},{loop:true});
  addClip('Land',.62,(p,t,u)=>{const c=Math.sin(u*Math.PI)**1.3;p.hips[1]=-.32*c;r(p,spine,.32*c);for(const side of ['L','R']){const L=limb['leg'+side],A=limb['arm'+side];r(p,L.thigh,-.63*c);r(p,L.shin,1.26*c);r(p,L.foot,-.63*c);r(p,A.upper,.2*c,0,A.s*.18*c);r(p,A.lower,-.35*c);curlF(p,side,.22);}secondaries(p,t,.1*(1-u));},{events:[{time:.1,event:'impact'}]});
  function key(u,keys){for(let i=1;i<keys.length;i++)if(u<=keys[i][0]){const a=keys[i-1],b=keys[i];return mix(a[1],b[1],smooth((u-a[0])/(b[0]-a[0])));}return keys.at(-1)[1];}
  function slash(name,side,duration,overhead=false){const s=side==='L'?1:-1;addClip(name,duration,(p,t,u)=>{idle(p,0,true);const A=limb['arm'+side],L=limb['leg'+side];const wind=key(u,[[0,0],[.3,1],[.48,-.82],[.62,-.65],[1,0]]),hit=Math.sin(clamp((u-.3)/.20)*Math.PI);
      r(p,chest,.12*hit,s*wind*.62,-s*wind*.14);r(p,spine,.08*hit,s*wind*.2,0);r(p,head,-.07,-s*wind*.22,0);
      r(p,A.upper,overhead?-1.9*wind:-.6-.42*wind,-s*.65*wind,s*(.5+.32*wind));r(p,A.lower,-.9+.75*hit,0,-s*.25*wind);r(p,A.hand,.2-.42*hit,s*.25*wind,-s*.18);curlF(p,side,hit?.12:.55,.015);
      r(p,L.thigh,-.22*hit);r(p,L.shin,.35*hit);r(p,L.foot,-.13*hit);p.hips[1]=-.08*hit;secondaries(p,t,.13);
    },{events:[{time:duration*.43,event:'hit_window_start'},{time:duration*.55,event:'hit_window_end'}]});}
  slash('Attack_Slash_Right','R',.95);slash('Attack_Slash_Left','L',1.02);slash('Attack_Overhead','R',1.3,true);
  addClip('Attack_Double_Claw',1.45,(p,t,u)=>{idle(p,0,true);const w=key(u,[[0,0],[.27,1],[.48,-.8],[.66,-.5],[1,0]]),hit=Math.sin(clamp((u-.28)/.26)*Math.PI);r(p,chest,.30*hit,0,0);p.hips[1]=-.13*hit;
    for(const side of ['L','R']){const A=limb['arm'+side],L=limb['leg'+side];r(p,A.upper,-.5-w*.55,0,A.s*(.50+.75*w));r(p,A.lower,-.8+.63*hit);r(p,A.hand,.22-.5*hit,0,-A.s*.2);curlF(p,side,.15+.40*(1-hit));r(p,L.thigh,-.25*hit);r(p,L.shin,.5*hit);r(p,L.foot,-.25*hit);}secondaries(p,t,.15);
  },{events:[{time:.64,event:'double_hit'}]});
  addClip('Attack_Stomp',1.35,(p,t,u)=>{idle(p,0,true);const lift=key(u,[[0,0],[.35,1],[.51,0],[.65,0],[1,0]]),shock=Math.exp(-(((u-.54)/.10)**2)),L=limb.legR;r(p,L.thigh,-1.05*lift);r(p,L.shin,1.22*lift);r(p,L.foot,-.25*lift);p.hips[1]=.09*lift-.13*shock;r(p,chest,-.12*lift+.25*shock);r(p,limb.armR.upper,-.5*lift,0,-.3*lift);secondaries(p,t,.16);},{events:[{time:.70,event:'stomp_impact'}]});
  addClip('Cast_Vines',2.2,(p,t,u)=>{idle(p,0,true);const e=smooth(u/.25)*(1-smooth((u-.72)/.28));r(p,chest,-.12*e);r(p,head,-.15*e);for(const side of ['L','R']){const A=limb['arm'+side];r(p,A.upper,-1.15*e,0,A.s*.25*e);r(p,A.lower,-.35-.35*e);r(p,A.hand,.35*e,0,A.s*.22*e);curlF(p,side,.35-.25*e,.02*e);}secondaries(p,t,.11);},{events:[{time:.9,event:'cast'}]});
  addClip('Hit_Front',.65,(p,t,u)=>{idle(p,0,true);const e=key(u,[[0,0],[.20,1],[.45,.65],[1,0]]);r(p,spine,-.25*e);r(p,chest,-.16*e,.13*e,0);r(p,head,.27*e);for(const side of ['L','R']){const A=limb['arm'+side];r(p,A.upper,.35*e,0,A.s*.2*e);r(p,A.lower,-.65);}p.hips[1]=-.06*e;secondaries(p,t,.15*(1-u));});
  addClip('Hit_Back',.7,(p,t,u)=>{idle(p,0,true);const e=key(u,[[0,0],[.2,1],[.5,.5],[1,0]]);r(p,spine,.28*e);r(p,chest,.14*e);r(p,head,-.2*e);p.hips[1]=-.08*e;for(const side of ['L','R'])r(p,limb['arm'+side].upper,-.45*e);secondaries(p,t,.14*(1-u));});
  addClip('Stagger',1.5,(p,t,u)=>{idle(p,0,true);const e=Math.sin(u*Math.PI);r(p,spine,.1*e,.12*Math.sin(u*TAU*2)*e,.16*Math.sin(u*TAU)*e);r(p,head,-.15*e,-.2*Math.sin(u*TAU)*e,.08*Math.sin(u*TAU*2)*e);for(const side of ['L','R']){const A=limb['arm'+side];r(p,A.upper,0,0,A.s*.3*e);r(p,A.lower,-.2);}p.hips[1]=-.08*e;secondaries(p,t,.13);});
  addClip('Roar',2.4,(p,t,u)=>{idle(p,0);const e=smooth(u/.25)*(1-smooth((u-.70)/.30));r(p,spine,-.14*e);r(p,chest,-.16*e);r(p,head,-.28*e,.055*Math.sin(t*23)*e,0);for(const side of ['L','R']){const A=limb['arm'+side];r(p,A.upper,.15*e,0,A.s*.56*e);r(p,A.lower,-.40*e);curlF(p,side,.08,.025*e);}secondaries(p,t,.12*e);},{events:[{time:.65,event:'roar'}]});
  addClip('Death',2.25,(p,t,u)=>{const fall=smooth((u-.25)/.55),shock=Math.exp(-(((u-.80)/.07)**2));p.root[1]=-.0;p.hips[1]=-1.69*fall+.04*shock;r(p,hips,-1.4*fall,.12*fall,-.12*fall);r(p,spine,.25*Math.sin(u*Math.PI));r(p,head,.27*fall,0,-.12*fall);
    for(const side of ['L','R']){const A=limb['arm'+side],L=limb['leg'+side];r(p,A.upper,-.15*fall,0,A.s*.46*fall);r(p,A.lower,-.4*fall);r(p,A.hand,.23*fall);r(p,L.thigh,-.18*fall);r(p,L.shin,.39*fall);r(p,L.foot,-.1*fall);curlF(p,side,.35);}secondaries(p,t,.10*(1-fall));},{events:[{time:1.8,event:'body_impact'}]});
  addClip('Spawn_Rise',2.4,(p,t,u)=>{const e=1-smooth(u/.86);p.hips[1]=-.85*e;r(p,hips,.13*e);r(p,spine,.36*e);r(p,head,.5*e);for(const side of ['L','R']){const L=limb['leg'+side],A=limb['arm'+side];r(p,L.thigh,-1.02*e);r(p,L.shin,1.9*e);r(p,L.foot,-.88*e);r(p,A.upper,-.25*e,0,A.s*.2*e);r(p,A.lower,-.55*e);curlF(p,side,.25);}secondaries(p,t,.06);});
  for(const s of [-1,1])addClip(s<0?'Turn_Right':'Turn_Left',.8,(p,t,u)=>{idle(p,0,true);r(p,master,0,s*Math.PI*.5*smooth(u),0);r(p,chest,0,s*.2*Math.sin(u*Math.PI),0);r(p,head,0,s*.2*Math.sin(u*Math.PI),0);for(const side of ['L','R']){const L=limb['leg'+side],phase=u*TAU+(side==='L'?0:Math.PI);r(p,L.thigh,-.12*Math.max(0,Math.sin(phase)));r(p,L.shin,.25*Math.max(0,Math.sin(phase)));}});
  k.root.userData={asset:'Harvest Revenant',author:'Codex Design 3D',units:'meters',forward:'+Z',reference:'User supplied pumpkin wooden guardian concept',rig:{type:'articulated wood with weighted mantle and stalk',bones:bones.length,fingers:'5 digits x 3 joints / hand',toes:'4 toes x 2 joints / foot',locomotion:'in-place, analytically baked two-link leg solve',fps:30},animationEvents:eventTable};
}
