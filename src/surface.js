import * as THREE from 'three';
import { bakeQuads } from './bake.js';
import { meshCharts, chartGeometry, renderAtlas } from './paint.js';
import { LOOK_DEFAULTS, rgb01 } from './look.js';

// Re-bake a painted mesh (userData.codexSurface) from its stored source, look options and gradient stack.
// Used by the kit (k.paint / k.gradient / k.look) and by the workshop's live Surface editor.
export async function rebakeSurface(m, root) {
    const S=m.userData.codexSurface;root.updateMatrixWorld(true);
    const model=new THREE.Box3();
    root.traverse(o=>{if(!o.isMesh||o.userData.codexHighlightShell||o===m)return;const g=o.userData.codexSurface?.source??o.geometry;if(!g.attributes.position)return;g.computeBoundingBox();model.union(g.boundingBox.clone().applyMatrix4(o.matrixWorld));});
    let part;
    if(S.kind==='quads'){part=new THREE.Box3();for(const q of S.quads)for(const [s,t] of [[0,0],[1,0],[0,1],[1,1]])part.expandByPoint(new THREE.Vector3(q.o[0]+q.u[0]*s+q.v[0]*t,q.o[1]+q.u[1]*s+q.v[1]*t,q.o[2]+q.u[2]*s+q.v[2]*t));}
    else{S.source.computeBoundingBox();part=S.source.boundingBox.clone();}
    model.union(part.clone().applyMatrix4(m.matrixWorld));
    const opts={...S.options,gradients:S.gradients,bounds:{model,part,world:model},matrixWorld:m.matrixWorld,name:m.name};
    let geometry,mat,atlas;
    if(S.kind==='quads')({geometry,material:mat,atlas}=await bakeQuads(S.quads,opts));
    else{const {charts}=meshCharts(S.source,{crease:opts.crease,hardAngle:opts.hardAngle,concaveRims:opts.concaveRims,colors:S.colors,ao:S.ao});const r=await renderAtlas(charts,{studs:'none',...opts});geometry=chartGeometry(S.source,charts,r);mat=r.material;atlas=r.atlas;}
    for(const key of ['transparent','opacity','side','alphaTest'])if(S.materialProps?.[key]!==undefined)mat[key]=S.materialProps[key];
    const oldG=m.geometry,oldM=m.material;m.geometry=geometry;m.material=mat;S.atlas=atlas;
    if(oldG!==S.source&&oldG!==geometry)oldG.dispose();
    for(const mm of [oldM].flat())if(mm&&mm!==mat){for(const v of Object.values(mm))if(v?.isTexture)v.dispose();mm.dispose();}
    return m;
  }


/** Recipe code that reproduces a mesh's current look + gradients (for copying live edits into the recipe). */
export function surfaceCode(m) {
  const S = m.userData.codexSurface; if (!S) return '';
  const look = {}; for (const [k, v] of Object.entries(S.options.look && typeof S.options.look === 'object' ? { ...S.options.look, ...S.options } : S.options)) if (k in LOOK_DEFAULTS && typeof v !== 'function' && v !== null && JSON.stringify(v) !== JSON.stringify(LOOK_DEFAULTS[k])) look[k] = v;
  const extra = ['studs', 'studScale', 'studStrength'].filter(k => S.options[k] !== undefined).map(k => `${k}:${JSON.stringify(S.options[k])}`);
  const grads = S.gradients.filter(g => !Object.values(g).some(v => typeof v === 'function'));
  return `await k.paint('${m.name}',{look:${JSON.stringify(look)}${extra.length ? ',' + extra.join(',') : ''}});` + grads.map(g => `\nawait k.gradient('${m.name}',${JSON.stringify(g)});`).join('');
}

/** Make a plain mesh paintable: keep its geometry as the source, its material colors as base colors, look 'flat'. */
export function initSurface(m) {
  const mats = [m.material].flat(), src = m.geometry.clone();
  return m.userData.codexSurface = { kind: 'mesh', source: src, colors: mats.map(x => rgb01('#' + (x.color ? x.color.getHexString(THREE.SRGBColorSpace) : 'ffffff'))), materialProps: { transparent: mats[0].transparent, opacity: mats[0].opacity, side: mats[0].side, alphaTest: mats[0].alphaTest }, options: { look: 'flat', roughness: mats[0].roughness, metalness: mats[0].metalness }, gradients: [] };
}
