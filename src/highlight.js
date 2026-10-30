import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { edgePrepShader, edgeCompositeShader } from './edges.js';

// Roblox-style Highlight: screen-space silhouette fill + outline around an adornee (object and descendants).
// Settings live in object.userData.codexHighlight, so GLTFExporter writes them to node `extras` and
// GLTFLoader restores them on import. Optional baked shells give engines without highlights a visible outline.
// Roblox renders at most 255 Highlights at once (raised from 31 on 2025-11-10); extra ones are silently ignored.
export const MAX_HIGHLIGHTS = 255;
export const HIGHLIGHT_DEFAULTS = Object.freeze({
  enabled: true, fillColor: '#ff0000', fillTransparency: 0.5, outlineColor: '#ffffff', outlineTransparency: 0, depthMode: 'AlwaysOnTop',
  // Codex Design extensions (viewer + Luau export where possible; Roblox itself ignores the rest).
  outlineWidth: 3, glow: 0, glowColor: null, glowTransparency: 0.35, fillStyle: 'solid', pulse: null,
});
const ALIASES = { FillColor: 'fillColor', FillTransparency: 'fillTransparency', OutlineColor: 'outlineColor', OutlineTransparency: 'outlineTransparency', DepthMode: 'depthMode', Enabled: 'enabled', Name: 'name' };
const FILL_STYLES = ['solid', 'fresnel', 'stripes'];
const toHex = c => {
  if (c === null || c === undefined) return c;
  if (Array.isArray(c)) return '#' + new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace);
  return '#' + new THREE.Color(c).getHexString();
};
/** Accepts Roblox PascalCase or camelCase keys; colors as '#hex', CSS names, THREE.Color or Color3.fromRGB-style [r,g,b]. */
export function normalizeHighlight(input = {}, base = HIGHLIGHT_DEFAULTS) {
  const out = { ...base };
  for (const [key, value] of Object.entries(input)) out[ALIASES[key] ?? key] = value;
  for (const key of ['fillColor', 'outlineColor', 'glowColor']) out[key] = toHex(out[key]);
  for (const key of ['fillTransparency', 'outlineTransparency', 'glowTransparency']) out[key] = THREE.MathUtils.clamp(Number(out[key]), 0, 1);
  out.depthMode = /occluded/i.test(String(out.depthMode)) ? 'Occluded' : 'AlwaysOnTop';
  out.outlineWidth = THREE.MathUtils.clamp(Number(out.outlineWidth), 0, 16); out.glow = THREE.MathUtils.clamp(Number(out.glow), 0, 24);
  if (!FILL_STYLES.includes(out.fillStyle)) throw new Error(`fillStyle must be ${FILL_STYLES.join(' | ')}`);
  if (out.pulse) out.pulse = { speed: Number(out.pulse.speed ?? 1), amount: THREE.MathUtils.clamp(Number(out.pulse.amount ?? 0.35), 0, 1) };
  out.enabled = out.enabled !== false;
  for (const key of ['fillTransparency', 'outlineTransparency', 'outlineWidth', 'glow']) if (!Number.isFinite(out[key])) throw new Error(`Invalid highlight ${key}`);
  return out;
}
export function setHighlight(object, settings) {
  if (!object?.isObject3D) throw new Error('Highlight adornee must be an Object3D (mesh, group or bone)');
  if (settings === null) { delete object.userData.codexHighlight; return null; }
  const value = normalizeHighlight(settings, object.userData.codexHighlight ?? HIGHLIGHT_DEFAULTS);
  value.name ??= `${object.name || 'Asset'}Highlight`;
  object.userData.codexHighlight = value; return value;
}
/** Highlight entries in traversal order (parents before children, so nested highlights draw on top). */
export function collectHighlights(root) {
  const list = []; root?.traverse(o => { if (o.userData?.codexHighlight && !o.userData.codexHighlightShell) list.push({ object: o, settings: o.userData.codexHighlight }); }); return list;
}
export function highlightMeshes(object) { const meshes = []; object.traverse(o => { if (o.isMesh && o.visible && !o.userData.codexHighlightShell) meshes.push(o); }); return meshes; }
export function inspectHighlights(root) {
  const list = collectHighlights(root), warnings = [];
  const enabled = list.filter(h => h.settings.enabled).length;
  if (enabled > MAX_HIGHLIGHTS) warnings.push(`${enabled} enabled highlights; Roblox renders at most ${MAX_HIGHLIGHTS}`);
  for (const h of list) if (!highlightMeshes(h.object).length) warnings.push(`Highlight ${h.settings.name} has no visible meshes under ${h.object.name}`);
  return { count: list.length, enabled, items: list.map(h => ({ adornee: h.object.name, ...h.settings })), warnings };
}

// ---------- Screen-space renderer ----------
const vertex = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const MAX_RADIUS = 40;
const prepShader = {
  uniforms: { tMask: { value: null }, tMaskDepth: { value: null }, tSceneDepth: { value: null }, near: { value: 0.1 }, far: { value: 100 }, ortho: { value: false } },
  vertexShader: vertex,
  fragmentShader: `#include <packing>
    uniform sampler2D tMask, tMaskDepth, tSceneDepth; uniform float near, far; uniform bool ortho; varying vec2 vUv;
    float viewZ(float d){ return ortho ? orthographicDepthToViewZ(d, near, far) : perspectiveDepthToViewZ(d, near, far); }
    void main(){
      float inside = step(0.001, texture2D(tMask, vUv).a);
      float mz = viewZ(texture2D(tMaskDepth, vUv).x), sz = viewZ(texture2D(tSceneDepth, vUv).x);
      float occluded = step(abs(mz) * 0.003 + 0.0008, sz - mz); // another surface sits in front of the adornee
      gl_FragColor = vec4(inside, inside * (1.0 - occluded), 0.0, 1.0);
    }`,
};
// Exact separable Euclidean distance transform (Felzenszwalb-style brute force within a radius).
const edtShader = horizontal => ({
  uniforms: { tInput: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 4 } },
  vertexShader: vertex,
  fragmentShader: `uniform sampler2D tInput; uniform vec2 texel; uniform float radius; varying vec2 vUv;
    void main(){
      float far = radius + 1.0; vec2 best = vec2(far);
      for (int i = -${MAX_RADIUS}; i <= ${MAX_RADIUS}; i++) {
        float d = float(i); if (abs(d) > radius) continue;
        ${horizontal
          ? `vec2 s = texture2D(tInput, vUv + vec2(d * texel.x, 0.0)).rg; if (s.r > 0.5) best.x = min(best.x, abs(d)); if (s.g > 0.5) best.y = min(best.y, abs(d));`
          : `vec2 s = texture2D(tInput, vUv + vec2(0.0, d * texel.y)).rg; best = min(best, vec2(length(vec2(s.r, d)), length(vec2(s.g, d))));`}
      }
      gl_FragColor = vec4(best, 0.0, 1.0);
    }`,
});
const compositeShader = {
  uniforms: {
    tMask: { value: null }, tDist: { value: null }, fillColor: { value: new THREE.Color() }, fillAlpha: { value: 0.5 }, outlineColor: { value: new THREE.Color() }, outlineAlpha: { value: 1 },
    outlineWidth: { value: 3 }, glow: { value: 0 }, glowColor: { value: new THREE.Color() }, glowAlpha: { value: 0.6 }, occludedMode: { value: false }, fillStyle: { value: 0 }, time: { value: 0 }, pixelRatio: { value: 1 },
  },
  vertexShader: vertex,
  fragmentShader: `uniform sampler2D tMask, tDist; uniform vec3 fillColor, outlineColor, glowColor; uniform float fillAlpha, outlineAlpha, outlineWidth, glow, glowAlpha, time, pixelRatio; uniform bool occludedMode; uniform int fillStyle; varying vec2 vUv;
    void main(){
      vec4 m = texture2D(tMask, vUv); vec2 d2 = texture2D(tDist, vUv).rg; float dist = occludedMode ? d2.y : d2.x;
      float inside = step(dist, 0.01);
      float fa = fillAlpha * inside;
      if (fillStyle == 1) { vec3 n = m.rgb * 2.0 - 1.0; fa *= mix(0.12, 1.0, pow(1.0 - clamp(abs(n.z), 0.0, 1.0), 1.6)); }
      if (fillStyle == 2) { float s = fract((gl_FragCoord.x + gl_FragCoord.y) / (14.0 * pixelRatio) - time * 0.8); fa *= mix(0.25, 1.0, step(0.5, s)); }
      float outside = 1.0 - inside;
      float oa = outlineAlpha * outside * (1.0 - smoothstep(outlineWidth - 0.5, outlineWidth + 0.5, dist)) * step(0.01, outlineWidth);
      float ga = glow > 0.0 ? glowAlpha * outside * pow(clamp(1.0 - (dist - outlineWidth) / glow, 0.0, 1.0), 2.0) * step(outlineWidth, dist) : 0.0;
      // Premultiplied layering: glow and fill underneath, outline on top.
      vec4 c = vec4(glowColor * ga, ga);
      c = vec4(fillColor * fa, fa) + c * (1.0 - fa);
      c = vec4(outlineColor * oa, oa) + c * (1.0 - oa);
      gl_FragColor = c;
    }`,
};
// Output: scalable ambient occlusion from the resolved scene depth, then tone mapping, then highlights.
// AO also darkens the transparent shadow floor (alpha), which gives contact occlusion under the model.
const outputShader = {
  uniforms: { tScene: { value: null }, tHighlight: { value: null }, hasHighlight: { value: false }, tDepth: { value: null }, projInv: { value: new THREE.Matrix4() }, proj: { value: new THREE.Matrix4() }, resolution: { value: new THREE.Vector2(1, 1) }, aoEnabled: { value: false }, aoStrength: { value: 1 }, aoRadius: { value: 0.2 } },
  vertexShader: vertex,
  fragmentShader: `uniform sampler2D tScene, tHighlight, tDepth; uniform bool hasHighlight, aoEnabled; uniform mat4 projInv, proj; uniform vec2 resolution; uniform float aoStrength, aoRadius; varying vec2 vUv;
    vec3 viewPos(vec2 uv){ float d = texture2D(tDepth, uv).x; vec4 v = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
    float ambientOcclusion(){
      float depth = texture2D(tDepth, vUv).x; if (depth >= 1.0) return 1.0;
      vec2 px = 1.0 / resolution; vec3 p = viewPos(vUv);
      // Normal from the neighbour pair with the smaller depth step (stable on silhouettes).
      vec3 l = viewPos(vUv - vec2(px.x, 0.0)), r = viewPos(vUv + vec2(px.x, 0.0)), b = viewPos(vUv - vec2(0.0, px.y)), t = viewPos(vUv + vec2(0.0, px.y));
      vec3 dx = abs(r.z - p.z) < abs(p.z - l.z) ? r - p : p - l, dy = abs(t.z - p.z) < abs(p.z - b.z) ? t - p : p - b;
      vec3 n = normalize(cross(dx, dy));
      float screenRadius = min(aoRadius * proj[1][1] * 0.5 * resolution.y / max(-p.z, 1e-4), resolution.y * 0.12);
      if (screenRadius < 1.0) return 1.0;
      float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float occ = 0.0;
      for (int i = 0; i < 16; i++) {
        float f = (float(i) + 0.5) / 16.0, a = (float(i) * 2.39996 + noise * 6.28318);
        vec2 suv = vUv + vec2(cos(a), sin(a)) * px * screenRadius * sqrt(f) * (0.6 + 0.4 * noise);
        if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) continue;
        vec3 v = viewPos(suv) - p; float len = length(v);
        occ += max(dot(v, n) / max(len, 1e-5) - 0.08, 0.0) * smoothstep(aoRadius * 1.6, aoRadius * 0.4, len);
      }
      return clamp(1.0 - aoStrength * occ / 16.0 * 1.6, 0.0, 1.0);
    }
    void main(){
      gl_FragColor = texture2D(tScene, vUv);
      if (aoEnabled) { float ao = ambientOcclusion(); gl_FragColor.rgb *= ao; gl_FragColor.a = gl_FragColor.a + (1.0 - gl_FragColor.a) * (1.0 - ao) * 0.85; }
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      if (hasHighlight) { vec4 h = texture2D(tHighlight, vUv); gl_FragColor = vec4(gl_FragColor.rgb * (1.0 - h.a) + h.rgb, gl_FragColor.a * (1.0 - h.a) + h.a); }
    }`,
};
const MASK_LAYER = 31;
const srgb = (target, hex) => target.setStyle(hex ?? '#ffffff', THREE.SRGBColorSpace).convertLinearToSRGB();

export class HighlightRenderer {
  constructor(renderer) {
    this.renderer = renderer; this.enabled = true; this.extra = []; this.time = 0; this.ao = { enabled: false, strength: 1, radius: 0.2 };
    const target = (opts = {}) => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, ...opts });
    this.sceneRT = target({ samples: 4, depthTexture: new THREE.DepthTexture(1, 1) });
    this.maskRT = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
    this.prepRT = target(); this.edtRT = target(); this.distRT = target();
    this.highlightRT = new THREE.WebGLRenderTarget(1, 1);
    const pass = (shader, extra = {}) => new FullScreenQuad(new THREE.ShaderMaterial({ ...shader, uniforms: THREE.UniformsUtils.clone(shader.uniforms), depthTest: false, depthWrite: false, ...extra }));
    this.prep = pass(prepShader); this.edtH = pass(edtShader(true)); this.edtV = pass(edtShader(false));
    this.composite = pass(compositeShader, { transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, toneMapped: false });
    this.output = pass(outputShader);
    this.edgePrep = pass(edgePrepShader);
    this.edgeComposite = pass(edgeCompositeShader, { transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, toneMapped: false });
    this.maskMaterials = new WeakMap(); this.normalMask = null; this.size = new THREE.Vector2(1, 1);
  }
  setSize(width, height) {
    const pr = this.renderer.getPixelRatio(), w = Math.max(1, Math.floor(width * pr)), h = Math.max(1, Math.floor(height * pr));
    for (const rt of [this.sceneRT, this.maskRT, this.prepRT, this.edtRT, this.distRT, this.highlightRT]) rt.setSize(w, h);
    this.size = new THREE.Vector2(w, h);
  }
  maskMaterial(material, skinned) {
    // View-space normals in RGB (fresnel fill) and coverage in alpha; alpha-tested textures keep their cutout.
    if (material.map && (material.alphaTest > 0 || material.transparent)) {
      if (!this.maskMaterials.has(material)) this.maskMaterials.set(material, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.5, 1), map: material.map, alphaTest: Math.max(0.3, material.alphaTest), side: material.side, toneMapped: false }));
      return this.maskMaterials.get(material);
    }
    const key = material.side + (skinned ? 's' : '');
    this.normalMask ??= {};
    return this.normalMask[key] ??= new THREE.MeshNormalMaterial({ side: material.side });
  }
  /** entries: [{object, settings, kind?}] from collectHighlights / collectEdges (kind 'edges'), plus this.extra (selection/hover). */
  render(scene, camera, entries = []) {
    const r = this.renderer, key = e => e.kind === 'edges' ? 'codexEdges' : 'codexHighlight';
    const live = e => ({ object: e.object, kind: e.kind, settings: e.object.userData[key(e)] ?? e.settings });
    const active = this.enabled ? entries.map(live).filter(e => e.settings.enabled && e.object.userData[key(e)]) : [];
    active.push(...this.extra.filter(e => e.object && e.settings.enabled));
    const background = scene.background;
    r.setRenderTarget(this.sceneRT); r.clear(); r.render(scene, camera);
    if (active.length) {
      // Passes accumulate into highlightRT, so automatic clears must be off until the output pass.
      const autoClear = r.autoClear; r.autoClear = false;
      r.setRenderTarget(this.highlightRT); r.setClearColor(0x000000, 0); r.clear();
      const layers = camera.layers.mask; scene.background = null;
      const texel = new THREE.Vector2(1 / this.size.x, 1 / this.size.y), pr = r.getPixelRatio();
      for (const [index, { object, settings, kind }] of active.entries()) {
        if (index >= MAX_HIGHLIGHTS * 2 + this.extra.length) break;
        const meshes = highlightMeshes(object); if (!meshes.length) continue;
        const swapped = meshes.map(m => { const original = m.material; m.material = Array.isArray(original) ? original.map(x => this.maskMaterial(x, m.isSkinnedMesh)) : this.maskMaterial(original, m.isSkinnedMesh); m.layers.enable(MASK_LAYER); return [m, original]; });
        camera.layers.set(MASK_LAYER);
        r.setRenderTarget(this.maskRT); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, camera);
        camera.layers.mask = layers; for (const [m, original] of swapped) { m.material = original; m.layers.disable(MASK_LAYER); }
        if (kind === 'edges') { this.renderEdges(settings, camera, texel, pr); continue; }
        const pulse = settings.pulse ? (0.5 - 0.5 * Math.cos(this.time * Math.PI * 2 * settings.pulse.speed)) * settings.pulse.amount : 0;
        const width = settings.outlineWidth * pr, glow = settings.glow * pr, radius = Math.min(MAX_RADIUS, Math.ceil(width + glow + 1));
        Object.assign(this.prep.material.uniforms, { tMask: { value: this.maskRT.texture }, tMaskDepth: { value: this.maskRT.depthTexture }, tSceneDepth: { value: this.sceneRT.depthTexture }, near: { value: camera.near }, far: { value: camera.far }, ortho: { value: !!camera.isOrthographicCamera } });
        r.setRenderTarget(this.prepRT); this.prep.render(r);
        Object.assign(this.edtH.material.uniforms, { tInput: { value: this.prepRT.texture }, texel: { value: texel }, radius: { value: radius } });
        r.setRenderTarget(this.edtRT); this.edtH.render(r);
        Object.assign(this.edtV.material.uniforms, { tInput: { value: this.edtRT.texture }, texel: { value: texel }, radius: { value: radius } });
        r.setRenderTarget(this.distRT); this.edtV.render(r);
        const u = this.composite.material.uniforms;
        u.tMask.value = this.maskRT.texture; u.tDist.value = this.distRT.texture;
        srgb(u.fillColor.value, settings.fillColor); srgb(u.outlineColor.value, settings.outlineColor); srgb(u.glowColor.value, settings.glowColor ?? settings.outlineColor);
        u.fillAlpha.value = THREE.MathUtils.clamp(1 - settings.fillTransparency - pulse, 0, 1); u.outlineAlpha.value = THREE.MathUtils.clamp(1 - settings.outlineTransparency - pulse * 0.4, 0, 1);
        u.outlineWidth.value = width; u.glow.value = glow; u.glowAlpha.value = 1 - settings.glowTransparency; u.occludedMode.value = settings.depthMode === 'Occluded';
        u.fillStyle.value = FILL_STYLES.indexOf(settings.fillStyle); u.time.value = this.time; u.pixelRatio.value = pr;
        r.setRenderTarget(this.highlightRT); this.composite.render(r);
      }
      scene.background = background; r.autoClear = autoClear;
    }
    const ou = this.output.material.uniforms; ou.tDepth.value = this.sceneRT.depthTexture; ou.proj.value.copy(camera.projectionMatrix); ou.projInv.value.copy(camera.projectionMatrixInverse); ou.resolution.value.copy(this.size); ou.aoEnabled.value = this.ao.enabled; ou.aoStrength.value = this.ao.strength; ou.aoRadius.value = this.ao.radius;
    this.output.material.uniforms.tScene.value = this.sceneRT.texture; this.output.material.uniforms.tHighlight.value = this.highlightRT.texture; this.output.material.uniforms.hasHighlight.value = active.length > 0;
    r.setRenderTarget(null); this.output.render(r);
  }
  /** Edge outline: crease/silhouette pixels from the mask's normals and depth, widened by the same distance transform. */
  renderEdges(s, camera, texel, pr) {
    const r = this.renderer, depth = { tMaskDepth: { value: this.maskRT.depthTexture }, tSceneDepth: { value: this.sceneRT.depthTexture }, near: { value: camera.near }, far: { value: camera.far }, ortho: { value: !!camera.isOrthographicCamera } };
    const width = s.thickness * pr, radius = Math.min(MAX_RADIUS, Math.ceil(width / 2 + 2));
    Object.assign(this.edgePrep.material.uniforms, depth, { tMask: { value: this.maskRT.texture }, texel: { value: texel }, creaseCos: { value: Math.cos(THREE.MathUtils.degToRad(s.creaseAngle)) }, silhouette: { value: s.silhouette }, creases: { value: s.creases } });
    r.setRenderTarget(this.prepRT); this.edgePrep.render(r);
    Object.assign(this.edtH.material.uniforms, { tInput: { value: this.prepRT.texture }, texel: { value: texel }, radius: { value: radius } });
    r.setRenderTarget(this.edtRT); this.edtH.render(r);
    Object.assign(this.edtV.material.uniforms, { tInput: { value: this.edtRT.texture }, texel: { value: texel }, radius: { value: radius } });
    r.setRenderTarget(this.distRT); this.edtV.render(r);
    const u = this.edgeComposite.material.uniforms; Object.assign(u, depth);
    u.tMask.value = this.maskRT.texture; u.tDist.value = this.distRT.texture; srgb(u.color.value, s.color); srgb(u.fillColor.value, s.fillColor);
    u.alpha.value = 1 - s.transparency; u.thickness.value = width; u.fillAlpha.value = s.fill ? 1 - s.fillTransparency : 0; u.occludedMode.value = s.depthMode === 'Occluded';
    r.setRenderTarget(this.highlightRT); this.edgeComposite.render(r);
  }
  dispose() { for (const rt of [this.sceneRT, this.maskRT, this.prepRT, this.edtRT, this.distRT, this.highlightRT]) rt.dispose(); for (const p of [this.prep, this.edtH, this.edtV, this.composite, this.output, this.edgePrep, this.edgeComposite]) { p.material.dispose(); p.dispose(); } }
}

// ---------- Export helpers ----------
function smoothNormals(geometry) {
  const p = geometry.attributes.position, n = geometry.attributes.normal ?? (geometry.computeVertexNormals(), geometry.attributes.normal), sums = new Map(), key = i => `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
  for (let i = 0; i < p.count; i++) { const k = key(i), s = sums.get(k) ?? new THREE.Vector3(); s.x += n.getX(i); s.y += n.getY(i); s.z += n.getZ(i); sums.set(k, s); }
  return i => sums.get(key(i)).clone().normalize();
}
export function shellGeometry(source, distance, flip) {
  const g = source.clone(); g.clearGroups(); g.morphAttributes = {};
  const p = g.attributes.position, normal = smoothNormals(source);
  for (let i = 0; i < p.count; i++) { const n = normal(i); if (!Number.isFinite(n.x)) continue; p.setXYZ(i, p.getX(i) + n.x * distance, p.getY(i) + n.y * distance, p.getZ(i) + n.z * distance); }
  if (flip) {
    if (g.index) { const idx = g.index; for (let j = 0; j < idx.count; j += 3) { const a = idx.getX(j); idx.setX(j, idx.getX(j + 2)); idx.setX(j + 2, a); } }
    else for (const attr of Object.values(g.attributes)) for (let j = 0; j < attr.count; j += 3) for (let d = 0; d < attr.itemSize; d++) { const s = attr.array, a = s[j * attr.itemSize + d]; s[j * attr.itemSize + d] = s[(j + 2) * attr.itemSize + d]; s[(j + 2) * attr.itemSize + d] = a; }
    const nrm = g.attributes.normal; if (nrm) for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
  }
  p.needsUpdate = true; g.computeBoundingSphere(); return g;
}
/** Adds inverted-hull outline and translucent fill shells next to highlighted meshes (call on an export copy). */
export function bakeHighlightShells(root, { fill = true } = {}) {
  root.updateMatrixWorld(true); let count = 0;
  for (const { object, settings } of collectHighlights(root)) {
    if (!settings.enabled) continue;
    const meshes = highlightMeshes(object), box = new THREE.Box3().setFromObject(object), diag = box.getSize(new THREE.Vector3()).length() || 1;
    const thickness = settings.bakeThickness ?? THREE.MathUtils.clamp(diag * 0.004 * Math.max(1, settings.outlineWidth), 0.002, 0.08);
    for (const mesh of meshes) {
      const scale = mesh.matrixWorld.getMaxScaleOnAxis() || 1, layers = [];
      if (settings.outlineTransparency < 0.99 && settings.outlineWidth > 0) layers.push(['Outline', thickness / scale, true, settings.outlineColor, 1 - settings.outlineTransparency]);
      if (settings.glow > 0 && settings.glowTransparency < 0.99) layers.push(['Glow', thickness * (1 + settings.glow / Math.max(1, settings.outlineWidth)) / scale, true, settings.glowColor ?? settings.outlineColor, Math.max(0.05, (1 - settings.glowTransparency) * 0.45)]);
      if (fill && settings.fillTransparency < 0.99) layers.push(['Fill', thickness * 0.08 / scale, false, settings.fillColor, 1 - settings.fillTransparency]);
      for (const [kind, distance, flip, color, opacity] of layers) {
        const mat = new THREE.MeshBasicMaterial({ name: `Highlight_${kind}`, color, transparent: opacity < 1, opacity, depthWrite: kind === 'Outline' });
        if (kind === 'Glow') { mat.blending = THREE.AdditiveBlending; mat.depthWrite = false; }
        const geo = shellGeometry(mesh.geometry, distance, flip);
        let shell;
        if (mesh.isSkinnedMesh) { shell = new THREE.SkinnedMesh(geo, mat); shell.bind(mesh.skeleton, mesh.bindMatrix); }
        else if (mesh.isInstancedMesh) { shell = new THREE.InstancedMesh(geo, mat, mesh.count); shell.instanceMatrix.copy(mesh.instanceMatrix); }
        else shell = new THREE.Mesh(geo, mat);
        shell.name = `${mesh.name || 'Mesh'}_Highlight${kind}`; shell.userData = { codexHighlightShell: kind.toLowerCase(), highlight: settings.name };
        shell.position.copy(mesh.position); shell.quaternion.copy(mesh.quaternion); shell.scale.copy(mesh.scale); shell.castShadow = shell.receiveShadow = false;
        mesh.parent.add(shell); count++;
      }
    }
  }
  return count;
}
export const rgb = hex => { const c = new THREE.Color().setStyle(hex, THREE.SRGBColorSpace).convertLinearToSRGB(); return [c.r, c.g, c.b].map(v => Math.round(v * 255)).join(', '); };
export const lua = s => JSON.stringify(String(s));
/** CodexOutline: a Luau runtime for the baked outline/fill/glow shells, so outlines work in Roblox without
 *  the Highlight instance (shells are real MeshParts in the model and follow bones/animation).
 *  Works as a Script (auto-setup on script.Parent) or as a ModuleScript (require(...).Setup(model)). */
export function highlightsToLuau(root, modelName = 'Asset', extraDefinitions = []) {
  const items = collectHighlights(root), n = v => +Number(v).toFixed(3);
  const defs = items.map(({ object, settings: s }) => {
    const meshes = highlightMeshes(object).map(m => m.name || 'Mesh');
    const list = suffix => `{${meshes.map(m => lua(`${m}_Highlight${suffix}`)).join(', ')}}`;
    return [`\t{`, `\t\tName = ${lua(s.name)}, Adornee = ${lua(object === root ? modelName : object.name)}, Enabled = ${s.enabled},`,
      `\t\tOutlineColor = Color3.fromRGB(${rgb(s.outlineColor)}), OutlineTransparency = ${n(s.outlineTransparency)},`,
      `\t\tFillColor = Color3.fromRGB(${rgb(s.fillColor)}), FillTransparency = ${n(s.fillTransparency)},`,
      `\t\tGlowColor = Color3.fromRGB(${rgb(s.glowColor ?? s.outlineColor)}), GlowTransparency = ${n(1 - Math.max(0.05, (1 - s.glowTransparency) * 0.45))},`,
      `\t\tDepthMode = ${lua(s.depthMode)}, Pulse = ${s.pulse ? `{Speed = ${n(s.pulse.speed)}, Amount = ${n(s.pulse.amount)}}` : 'nil'},`,
      `\t\tOutline = ${list('Outline')}, Fill = ${list('Fill')}, Glow = ${list('Glow')},`, `\t},`].join('\n');
  });
  return LUAU_TEMPLATE.replace('__MODEL__', modelName.replace(/"/g, '')).replace('__DEFINITIONS__', () => [...defs, ...extraDefinitions].join('\n'));
}
const LUAU_TEMPLATE = `--!nonstrict
-- CodexOutline · generated by Codex Design 3D for "__MODEL__"
-- Geometry outline system for Roblox. The GLB/glTF contains baked shell meshes next to each highlighted part:
--   <Part>_HighlightOutline  inverted hull (backfaces of an inflated copy) -> silhouette outline
--   <Part>_HighlightFill     thin translucent overlay                     -> Highlight-style fill tint
--   <Part>_HighlightGlow     wider faint hull                             -> soft glow
-- They are ordinary MeshParts: they render on every device, follow bones and animations, and need no
-- Highlight instance. This script styles them (color, transparency, material, no collision or shadows)
-- and lets you recolor, toggle and pulse them at runtime.
--
-- USE: import the .glb with the 3D Importer (keep the hierarchy, do not merge meshes), then either
--   * put this file as a Script inside the imported Model (Setup runs automatically), or
--   * make it a ModuleScript:  local Outline = require(path.To.CodexOutline)
--                              local h = Outline.Setup(model)
--                              h:SetOutline("PickupHighlight", Color3.new(1, 0, 0), 0)
--                              h:SetFill(name, color, 0.6)  h:SetEnabled(name, false)  h:Pulse(name, 1, 0.35)
-- Options.UseRobloxHighlight = true also adds native Highlights (only needed for AlwaysOnTop x-ray).

local TweenService = game:GetService("TweenService")

local CodexOutline = {}
CodexOutline.Options = {
	OutlineMaterial = Enum.Material.Neon,          -- flat, unlit-looking color like Highlight outlines
	FillMaterial = Enum.Material.SmoothPlastic,    -- translucent tint over the part
	GlowMaterial = Enum.Material.Neon,
	UseRobloxHighlight = false,
	RemoveSurfaceAppearance = true,               -- imported shells may carry a SurfaceAppearance that overrides Color
}
CodexOutline.Definitions = {
__DEFINITIONS__
}

type Group = { def: any, outline: {BasePart}, fill: {BasePart}, glow: {BasePart}, tweens: {Tween}, native: Highlight? }
local Handle = {}
Handle.__index = Handle

local function findAll(model: Instance, names: {string}): {BasePart}
	local wanted, found = {}, {}
	for _, name in names do wanted[name] = true end
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") then
			-- Importers may append suffixes to duplicate names; match the prefix too.
			local base = string.match(d.Name, "^(.-_Highlight%a+)") or d.Name
			if wanted[d.Name] or wanted[base] then table.insert(found, d) end
		end
	end
	return found
end

local function style(part: BasePart, color: Color3, transparency: number, material: Enum.Material)
	part.Color = color
	part.Transparency = transparency
	part.Material = material
	part.CastShadow = false
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.Massless = true
	if CodexOutline.Options.RemoveSurfaceAppearance then
		for _, child in part:GetChildren() do
			if child:IsA("SurfaceAppearance") then child:Destroy() end
		end
	end
end

local function apply(g: Group)
	local d, on = g.def, g.def.Enabled
	for _, p in g.outline do style(p, d.OutlineColor, if on then d.OutlineTransparency else 1, CodexOutline.Options.OutlineMaterial) end
	for _, p in g.fill do style(p, d.FillColor, if on then d.FillTransparency else 1, CodexOutline.Options.FillMaterial) end
	for _, p in g.glow do style(p, d.GlowColor, if on then d.GlowTransparency else 1, CodexOutline.Options.GlowMaterial) end
	if g.native then
		g.native.Enabled = on
		g.native.FillColor, g.native.FillTransparency = d.FillColor, d.FillTransparency
		g.native.OutlineColor, g.native.OutlineTransparency = d.OutlineColor, d.OutlineTransparency
	end
end

function CodexOutline.Setup(model: Instance)
	local self = setmetatable({ model = model, groups = {} :: {[string]: Group} }, Handle)
	for _, def in CodexOutline.Definitions do
		local d = table.clone(def)
		local g: Group = { def = d, outline = findAll(model, d.Outline), fill = findAll(model, d.Fill), glow = findAll(model, d.Glow), tweens = {} }
		if d.Enabled and #g.outline + #g.fill + #g.glow == 0 then
			warn(("[CodexOutline] no shells found for %s; export the GLB with highlight shells enabled"):format(d.Name))
		end
		if CodexOutline.Options.UseRobloxHighlight then
			local h = Instance.new("Highlight")
			h.Name = d.Name
			h.Adornee = if model.Name == d.Adornee then model else (model:FindFirstChild(d.Adornee, true) or model)
			h.DepthMode = (Enum.HighlightDepthMode :: any)[d.DepthMode]
			h.Parent = model
			g.native = h
		end
		self.groups[d.Name] = g
		apply(g)
		if d.Pulse then self:Pulse(d.Name, d.Pulse.Speed, d.Pulse.Amount) end
	end
	return self
end

function Handle:Get(name: string): Group
	local g = self.groups[name]
	assert(g, "Unknown outline: " .. tostring(name))
	return g
end
function Handle:SetEnabled(name: string, enabled: boolean)
	local g = self:Get(name); g.def.Enabled = enabled; apply(g)
end
function Handle:SetOutline(name: string, color: Color3?, transparency: number?)
	local g = self:Get(name); g.def.OutlineColor = color or g.def.OutlineColor; g.def.OutlineTransparency = transparency or g.def.OutlineTransparency; apply(g)
end
function Handle:SetFill(name: string, color: Color3?, transparency: number?)
	local g = self:Get(name); g.def.FillColor = color or g.def.FillColor; g.def.FillTransparency = transparency or g.def.FillTransparency; apply(g)
end
function Handle:SetGlow(name: string, color: Color3?, transparency: number?)
	local g = self:Get(name); g.def.GlowColor = color or g.def.GlowColor; g.def.GlowTransparency = transparency or g.def.GlowTransparency; apply(g)
end
function Handle:StopPulse(name: string)
	local g = self:Get(name)
	for _, t in g.tweens do t:Cancel() end
	table.clear(g.tweens); apply(g)
end
function Handle:Pulse(name: string, speed: number?, amount: number?)
	local g = self:Get(name)
	self:StopPulse(name)
	if not g.def.Enabled then return end
	local info = TweenInfo.new(0.5 / (speed or 1), Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true)
	local a = amount or 0.35
	for _, p in g.fill do table.insert(g.tweens, TweenService:Create(p, info, { Transparency = math.min(1, g.def.FillTransparency + a) })) end
	for _, p in g.glow do table.insert(g.tweens, TweenService:Create(p, info, { Transparency = math.min(1, g.def.GlowTransparency + a) })) end
	for _, p in g.outline do table.insert(g.tweens, TweenService:Create(p, info, { Transparency = math.min(1, g.def.OutlineTransparency + a * 0.4) })) end
	for _, t in g.tweens do t:Play() end
end
function Handle:Destroy()
	for name, g in self.groups do
		self:StopPulse(name)
		if g.native then g.native:Destroy() end
	end
	table.clear(self.groups)
end

if script:IsA("Script") then
	CodexOutline.Setup(script.Parent :: Instance)
end
return CodexOutline
`;
export const GLTF_EXTENSION = 'CODEX_highlight';
/** Marks highlighted nodes with the CODEX_highlight vendor extension (GLTFExporter includeCustomExtensions). Returns the count. */
export function tagHighlightExtensions(root) {
  let count = 0;
  for (const { object, settings } of collectHighlights(root)) {
    const { name, enabled, fillColor, fillTransparency, outlineColor, outlineTransparency, depthMode, ...extras } = settings;
    object.userData.gltfExtensions = { ...object.userData.gltfExtensions, [GLTF_EXTENSION]: { name, enabled, fillColor, fillTransparency, outlineColor, outlineTransparency, depthMode, extras } };
    count++;
  }
  return count;
}
/** Imported GLB: baked shells are hidden (the live highlight replaces them); returns restored highlight count. */
export function restoreImportedHighlights(root) {
  let count = 0;
  root.traverse(o => {
    const ext = o.userData?.gltfExtensions?.[GLTF_EXTENSION];
    if (o.userData?.codexHighlightShell) o.visible = false;
    else if (ext || o.userData?.codexHighlight) { const { extras, ...core } = ext ?? {}; o.userData.codexHighlight = normalizeHighlight(ext ? { ...extras, ...core } : o.userData.codexHighlight); count++; }
    if (o.userData?.gltfExtensions) delete o.userData.gltfExtensions[GLTF_EXTENSION];
  });
  return count;
}
