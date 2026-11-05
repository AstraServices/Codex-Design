// Path tracer core (runs in workers): BVH-accelerated (three-mesh-bvh) unidirectional path tracing with next-event
// estimation of a soft key light, studio environment, diffuse + GGX-style glossy/metal reflections, emissive surfaces,
// multi-bounce global illumination, Russian roulette and a shadow-catcher ground plane (alpha output for compositing).
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const rng = s => () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); };
const lin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

export function buildScene(data) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(data.position, 3)); g.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(data.color, 3)); g.setAttribute('mat', new THREE.BufferAttribute(data.mat, 1));
  const bvh = new MeshBVH(g); return { g, bvh, materials: data.materials, ground: data.ground, env: data.env, key: new THREE.Vector3(...data.key).normalize(), keyColor: data.keyColor, keySize: data.keySize, radius: data.radius };
}
function sampleTex(t, u, v) {
  if (!t) return null; u = u * t.repeat[0] + t.offset[0]; v = v * t.repeat[1] + t.offset[1]; u -= Math.floor(u); v -= Math.floor(v);
  const x = Math.min(t.w - 1, Math.floor(u * t.w)), y = Math.min(t.h - 1, Math.floor((t.flipY ? 1 - v : v) * t.h)), i = (y * t.w + x) * 4;
  return [t.data[i] / 255, t.data[i + 1] / 255, t.data[i + 2] / 255, t.data[i + 3] / 255];
}
function envColor(S, d) { // studio sky: bright top, soft horizon, dark floor, plus a large softbox lobe at the key
  const e = S.env, t = d.y, c = t > 0 ? e.horizon.map((h, i) => h + (e.top[i] - h) * Math.pow(t, 0.6)) : e.horizon.map((h, i) => h + (e.bottom[i] - h) * Math.min(1, -t * 3));
  const lobe = Math.pow(Math.max(0, d.dot(S.key)), 24) * 2.2; return c.map((x, i) => (x + lobe * S.keyColor[i]) * e.intensity);
}
function surface(S, hit) {
  const f = hit.face, b = new THREE.Vector3(); new THREE.Triangle(hitV(S, f.a), hitV(S, f.b), hitV(S, f.c)).getBarycoord(hit.point, b);
  const A = S.g.attributes, lerp = (attr, n) => { const o = []; for (let k = 0; k < n; k++) o.push(attr.array[f.a * n + k] * b.x + attr.array[f.b * n + k] * b.y + attr.array[f.c * n + k] * b.z); return o; };
  const n = new THREE.Vector3(...lerp(A.normal, 3)).normalize(), uv = lerp(A.uv, 2), vc = lerp(A.color, 3), M = S.materials[A.mat.array[f.a]] ?? S.materials[0];
  let base = M.color.map((c, i) => c * vc[i]), alpha = M.opacity; const tx = sampleTex(M.map, uv[0], uv[1]); if (tx) { base = base.map((c, i) => c * lin(tx[i])); alpha *= tx[3]; }
  let rough = M.roughness, metal = M.metalness; const rm = sampleTex(M.roughnessMap, uv[0], uv[1]); if (rm) rough *= rm[1]; const mm = sampleTex(M.metalnessMap, uv[0], uv[1]); if (mm) metal *= mm[2];
  let em = M.emissive; const et = sampleTex(M.emissiveMap, uv[0], uv[1]); if (et) em = em.map((c, i) => c * lin(et[i]));
  return { n, base, alpha, rough: Math.max(0.04, rough), metal, em };
}
const _v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]; let _vi = 0;
function hitV(S, i) { const v = _v[_vi = (_vi + 1) % 3]; return v.fromBufferAttribute(S.g.attributes.position, i); }
const cosineDir = (n, r) => { const u1 = r(), u2 = r(), rr = Math.sqrt(u1), th = 2 * Math.PI * u2, t = Math.abs(n.y) < 0.99 ? new THREE.Vector3(0, 1, 0).cross(n).normalize() : new THREE.Vector3(1, 0, 0).cross(n).normalize(), b = n.clone().cross(t); return t.multiplyScalar(rr * Math.cos(th)).add(b.multiplyScalar(rr * Math.sin(th))).add(n.clone().multiplyScalar(Math.sqrt(1 - u1))).normalize(); };
const jitterCone = (d, a, r) => { if (a <= 0) return d.clone(); const t = Math.abs(d.y) < 0.99 ? new THREE.Vector3(0, 1, 0).cross(d).normalize() : new THREE.Vector3(1, 0, 0).cross(d).normalize(), b = d.clone().cross(t), rr = a * Math.sqrt(r()), th = 2 * Math.PI * r(); return d.clone().add(t.multiplyScalar(rr * Math.cos(th))).add(b.multiplyScalar(rr * Math.sin(th))).normalize(); };

function occluded(S, o, d) { const ray = new THREE.Ray(o, d); return !!S.bvh.raycastFirst(ray, THREE.DoubleSide); }
/** Trace one camera ray → [r,g,b,alpha, firstHitNormal x3, depth] (linear radiance). */
function trace(S, ro, rd, r, maxBounces) {
  let thr = [1, 1, 1], rad = [0, 0, 0], alpha = 0, first = null, depth = 0; const o = ro.clone(), d = rd.clone(), ray = new THREE.Ray();
  for (let bounce = 0; bounce <= maxBounces; bounce++) {
    ray.origin.copy(o); ray.direction.copy(d); const hit = S.bvh.raycastFirst(ray, THREE.DoubleSide);
    // ground plane (shadow catcher)
    const tg = S.ground && d.y < -1e-4 ? (S.ground.y - o.y) / d.y : Infinity;
    if (!hit || hit.distance > tg) {
      if (tg < Infinity && S.ground) {
        const p = o.clone().addScaledVector(d, tg);
        if (bounce === 0) { // camera sees the floor: shadow amount as alpha (black), lit areas transparent
          let shade = occluded(S, p.clone().add(new THREE.Vector3(0, 1e-4 * S.radius, 0)), jitterCone(S.key, S.keySize, r)) ? 1 : 0; let ao = 0; for (let k = 0; k < 4; k++) { const h = S.bvh.raycastFirst(new THREE.Ray(p.clone().add(new THREE.Vector3(0, 1e-4 * S.radius, 0)), cosineDir(new THREE.Vector3(0, 1, 0), r)), THREE.DoubleSide); if (h && h.distance < S.radius) ao += 1 - h.distance / S.radius; }
          return { c: [0, 0, 0], a: Math.min(1, shade * S.ground.shadow + ao / 4 * S.ground.ao), n: [0, 1, 0], z: tg, floor: true };
        }
        const gd = S.ground.albedo; let L = [0, 0, 0]; if (!occluded(S, p.clone().add(new THREE.Vector3(0, 1e-4 * S.radius, 0)), jitterCone(S.key, S.keySize, r))) L = S.keyColor.map(k => k * Math.max(0, S.key.y));
        const e = envColor(S, new THREE.Vector3(0, 1, 0)); for (let i = 0; i < 3; i++) rad[i] += thr[i] * gd * (L[i] + e[i] * 0.5); break;
      }
      const e = envColor(S, d); for (let i = 0; i < 3; i++) rad[i] += thr[i] * e[i] * (bounce === 0 ? 0 : 1); break;
    }
    const s = surface(S, hit); if (bounce === 0) { alpha = s.alpha; first = s.n; depth = hit.distance; }
    const n = s.n.dot(d) > 0 ? s.n.clone().negate() : s.n, p = hit.point.clone().addScaledVector(n, 1e-4 * S.radius), v = d.clone().negate();
    for (let i = 0; i < 3; i++) rad[i] += thr[i] * s.em[i];
    const f0 = [0, 1, 2].map(i => 0.04 * (1 - s.metal) + s.base[i] * s.metal), diff = s.base.map(c => c * (1 - s.metal));
    // next-event estimation: soft key light
    const L = jitterCone(S.key, S.keySize, r), nl = n.dot(L);
    if (nl > 0 && !occluded(S, p, L)) { const h = L.clone().add(v).normalize(), nh = Math.max(0, n.dot(h)), a2 = s.rough ** 4, D = a2 / (Math.PI * (nh * nh * (a2 - 1) + 1) ** 2), nv = Math.max(1e-3, n.dot(v)), vh = Math.max(0, v.dot(h)), F = f0.map(x => x + (1 - x) * (1 - vh) ** 5), k = (s.rough + 1) ** 2 / 8, G = nl / (nl * (1 - k) + k) * nv / (nv * (1 - k) + k);
      for (let i = 0; i < 3; i++) rad[i] += thr[i] * S.keyColor[i] * nl * (diff[i] / Math.PI * (1 - F[i]) + D * G * F[i] / (4 * nl * nv)) * Math.PI; }
    // indirect bounce: glossy vs diffuse by Fresnel/metal
    const fr = f0.reduce((a, b) => a + b, 0) / 3, nv = Math.max(0, n.dot(v)), pSpec = Math.min(0.95, Math.max(0.08, fr + (1 - fr) * (1 - nv) ** 5 + s.metal * 0.5));
    if (r() < pSpec) { const refl = d.clone().reflect(n); let nd = jitterCone(refl, s.rough * s.rough * 1.2, r); if (nd.dot(n) < 0) nd = refl; const F = f0.map(x => x + (1 - x) * (1 - nv) ** 5); thr = thr.map((t, i) => t * F[i] / pSpec); d.copy(nd); }
    else { d.copy(cosineDir(n, r)); thr = thr.map((t, i) => t * diff[i] / (1 - pSpec)); }
    o.copy(p);
    const mx = Math.max(...thr); if (bounce > 1) { if (r() > mx) break; thr = thr.map(t => t / Math.max(mx, 1e-3)); }
  }
  return { c: rad, a: alpha, n: first ? [first.x, first.y, first.z] : [0, 0, 0], z: depth };
}

/** Render rows [y0,y1) → Float32Array RGBA (linear) + aux (normal xyz, depth). cam: {pos, invProj (16), world (16)} */
export function traceRows(S, cam, W, H, y0, y1, { spp = 16, bounces = 3, seed = 1 } = {}) {
  const out = new Float32Array((y1 - y0) * W * 4), aux = new Float32Array((y1 - y0) * W * 4), invP = new THREE.Matrix4().fromArray(cam.invProj), world = new THREE.Matrix4().fromArray(cam.world), ro = new THREE.Vector3(...cam.pos);
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
    const r = rng((y * 9781 + x * 6271 + seed * 1013) | 1); let acc = [0, 0, 0], a = 0, nrm = [0, 0, 0], z = 0;
    for (let s = 0; s < spp; s++) { const nx = (x + r()) / W * 2 - 1, ny = 1 - (y + r()) / H * 2, dir = new THREE.Vector3(nx, ny, 0.5).applyMatrix4(invP).applyMatrix4(world).sub(ro).normalize(), t = trace(S, ro, dir, r, bounces);
      for (let i = 0; i < 3; i++) acc[i] += t.c[i] * (t.floor ? 0 : 1); a += t.a; if (s === 0) { nrm = t.n; z = t.z; } }
    const k = ((y - y0) * W + x) * 4; out[k] = acc[0] / spp; out[k + 1] = acc[1] / spp; out[k + 2] = acc[2] / spp; out[k + 3] = a / spp; aux.set([...nrm, z], k);
  }
  return { out, aux };
}
