import { META } from '../watermark.js';
// VFX Studio: effect description (vfx/<id>.vfx.json) → Roblox instances, timeline, validation and package.
// Roblox-only by design: every layer is a real Roblox class (ParticleEmitter, Beam, Trail, PointLight/SpotLight/
// SurfaceLight, Part + SpecialMesh, Highlight, Bloom/ColorCorrection/Blur/DepthOfField). Three.js only previews it.
// Isomorphic (browser + Node). Textures resolve through an asset map {localPath: imageId}; a missing id is an error.
import { T, inst, add, ENUM } from './instances.js';

export const LAYER_TYPES = ['emitter', 'beam', 'trail', 'light', 'mesh', 'highlight', 'post'];
const POST = ['BloomEffect', 'ColorCorrectionEffect', 'BlurEffect', 'DepthOfFieldEffect'];
const LIGHTS = ['PointLight', 'SpotLight', 'SurfaceLight'];

/** Roblox defaults so every instance of a class carries the same property set (needed by RBXM). */
export const DEFAULTS = {
  ParticleEmitter: { Enabled: true, Rate: 20, Lifetime: [5, 10], Speed: [5, 5], SpreadAngle: [0, 0], Size: 1, Transparency: 0, Color: '#ffffff', LightEmission: 0, LightInfluence: 1, Brightness: 1,
    Drag: 0, Acceleration: [0, 0, 0], Rotation: [0, 0], RotSpeed: [0, 0], Orientation: 'FacingCamera', EmissionDirection: 'Top', Shape: 'Box', ShapeStyle: 'Volume', ShapeInOut: 'Outward', ShapePartial: 1,
    Squash: 0, ZOffset: 0, VelocityInheritance: 0, LockedToPart: false, TimeScale: 1, FlipbookLayout: 'None', FlipbookMode: 'Loop', FlipbookFramerate: [1, 1], FlipbookStartRandom: false, WindAffectsDrag: false },
  Beam: { Enabled: true, Color: '#ffffff', Transparency: 0, Width0: 1, Width1: 1, CurveSize0: 0, CurveSize1: 0, Segments: 10, TextureLength: 1, TextureMode: 'Stretch', TextureSpeed: 1, FaceCamera: true, LightEmission: 0, LightInfluence: 0, Brightness: 1, ZOffset: 0 },
  Trail: { Enabled: true, Color: '#ffffff', Transparency: 0, Lifetime: 0.5, MinLength: 0.1, MaxLength: 0, WidthScale: 1, FaceCamera: false, TextureLength: 1, TextureMode: 'Stretch', LightEmission: 0, LightInfluence: 1, Brightness: 1 },
  PointLight: { Enabled: true, Brightness: 2, Range: 12, Color: '#ffffff', Shadows: false },
  SpotLight: { Enabled: true, Brightness: 2, Range: 16, Color: '#ffffff', Shadows: false, Angle: 90, Face: 'Front' },
  SurfaceLight: { Enabled: true, Brightness: 2, Range: 16, Color: '#ffffff', Shadows: false, Angle: 90, Face: 'Front' },
  Highlight: { Enabled: true, FillColor: '#ffffff', FillTransparency: 0.5, OutlineColor: '#ffffff', OutlineTransparency: 0, DepthMode: 'Occluded' },
  BloomEffect: { Enabled: true, Intensity: 1, Size: 24, Threshold: 2 },
  ColorCorrectionEffect: { Enabled: true, Brightness: 0, Contrast: 0, Saturation: 0, TintColor: '#ffffff' },
  BlurEffect: { Enabled: true, Size: 24 },
  DepthOfFieldEffect: { Enabled: true, FarIntensity: 0.75, FocusDistance: 0.05, InFocusRadius: 10, NearIntensity: 0.75 },
};
// Property → serializer. Unknown keys are rejected by the validator (never exported as if Roblox supported them).
const ENUMS = { Orientation: 'ParticleOrientation', EmissionDirection: 'NormalId', Shape: 'ParticleEmitterShape', ShapeStyle: 'ParticleEmitterShapeStyle', ShapeInOut: 'ParticleEmitterShapeInOut',
  FlipbookLayout: 'FlipbookLayout', FlipbookMode: 'FlipbookMode', TextureMode: 'TextureMode', Face: 'NormalId', DepthMode: 'HighlightDepthMode' };
ENUM.HighlightDepthMode = { AlwaysOnTop: 0, Occluded: 1 };
const RANGES = new Set(['Lifetime', 'Speed', 'Rotation', 'RotSpeed', 'FlipbookFramerate']);
const SEQ = new Set(['Size', 'Transparency', 'Squash', 'WidthScale']);
const COLORSEQ = new Set(['Color']);
const VEC3 = new Set(['Acceleration']), VEC2 = new Set(['SpreadAngle']);
const BOOL = new Set(['Enabled', 'LockedToPart', 'FlipbookStartRandom', 'WindAffectsDrag', 'FaceCamera', 'Shadows']);
const INT = new Set(['Segments', 'FlipbookSizeX', 'FlipbookSizeY']);
const COLOR = new Set(['FillColor', 'OutlineColor', 'TintColor']);

function serialize(cls, key, v) {
  if (ENUMS[key]) { const table = ENUM[ENUMS[key]], n = typeof v === 'number' ? v : table?.[v]; if (n === undefined) throw new Error(`${cls}.${key}: unknown enum value ${v}`); return T.enum(n); }
  if (RANGES.has(key) && cls === 'ParticleEmitter') return Array.isArray(v) ? T.numrange(v[0], v[1] ?? v[0]) : T.numrange(v, v);
  if (SEQ.has(key) && (cls === 'ParticleEmitter' || cls === 'Beam' || cls === 'Trail')) return T.numseq(v);
  if (COLORSEQ.has(key) && ['ParticleEmitter', 'Beam', 'Trail'].includes(cls)) return T.colseq(v);
  if (key === 'Color' || COLOR.has(key)) return T.color3(v);
  if (VEC3.has(key)) return T.vec3(v);
  if (VEC2.has(key)) return T.vec2(v);
  if (BOOL.has(key)) return T.bool(v);
  if (INT.has(key)) return T.int(v);
  if (typeof v === 'number') return T.float(v);
  throw new Error(`${cls}.${key}: unsupported value ${JSON.stringify(v)}`);
}
const ALLOWED = Object.fromEntries(Object.entries(DEFAULTS).map(([c, d]) => [c, new Set([...Object.keys(d), ...(c === 'ParticleEmitter' ? ['FlipbookSizeX', 'FlipbookSizeY'] : [])])]));

function classProps(cls, props = {}, extra = {}) {
  const merged = { ...DEFAULTS[cls], ...props }, out = {};
  if (cls === 'ParticleEmitter' && merged.FlipbookLayout === 'Custom') { merged.FlipbookSizeX ??= 4; merged.FlipbookSizeY ??= 4; }
  for (const [k, v] of Object.entries(merged)) if (ALLOWED[cls]?.has(k)) out[k] = serialize(cls, k, v);
  return { ...out, ...extra };
}

export const textureKey = tex => !tex ? null : typeof tex === 'string' ? tex : tex.src ?? (tex.generated ? `generated:${tex.generated.kind}:${JSON.stringify(tex.generated)}` : null);
/** Content id for a layer texture: explicit assetId > asset map > '' (validator reports it). */
export function resolveTexture(tex, assets = {}) {
  if (!tex) return '';
  if (tex.assetId) return `rbxassetid://${String(tex.assetId).replace(/\D/g, '')}`;
  const id = assets[textureKey(tex)]; return id ? `rbxassetid://${id}` : '';
}

/** One effect → Folder template {Root part with attachments/emitters/beams/trails/lights, mesh parts, Timeline}. */
export function buildEffect(effect, { assets = {} } = {}) {
  const name = safeName(effect.name ?? 'Effect');
  const root = inst('Part', 'Root', { Anchored: T.bool(true), CanCollide: T.bool(false), CanQuery: T.bool(false), CanTouch: T.bool(false), CastShadow: T.bool(false), Locked: T.bool(true),
    Transparency: T.float(1), size: T.vec3([0.2, 0.2, 0.2]), CFrame: T.cframe([0, 0, 0]), Material: T.enum(ENUM.Material.SmoothPlastic), Color3uint8: T.color3u8('#ffffff'), shape: T.enum(ENUM.PartType.Block) });
  const folder = inst('Folder', name, {}, [root]), events = [], layerPath = new Map();
  const att = (lname, pos = [0, 0, 0], rot) => add(root, inst('Attachment', lname, { CFrame: T.cframe(pos, rot) }));
  let duration = effect.duration ?? 0;
  for (const L of effect.layers ?? []) {
    if (L.enabled === false) continue;
    const ln = safeName(L.name ?? L.type), t0 = L.delay ?? 0;
    if (L.type === 'emitter') {
      const a = att(ln + 'Att', L.offset, L.rotation), burst = (L.emit?.mode ?? 'burst') === 'burst';
      add(a, inst('ParticleEmitter', ln, classProps('ParticleEmitter', { ...L.props, Enabled: false }, { Texture: T.content(resolveTexture(L.texture, assets)) })));
      const path = `Root/${ln}Att/${ln}`; layerPath.set(L, path);
      if (burst) { for (const b of L.emit?.bursts ?? [{ t: 0, count: L.emit?.count ?? 20 }]) events.push({ t: t0 + (b.t ?? 0), kind: 'emit', target: path, count: b.count ?? 20 }); }
      else { events.push({ t: t0, kind: 'enable', target: path, on: true }); events.push({ t: t0 + (L.emit?.duration ?? effect.duration ?? 1), kind: 'enable', target: path, on: false }); }
      const life = Array.isArray(L.props?.Lifetime) ? L.props.Lifetime[1] ?? L.props.Lifetime[0] : L.props?.Lifetime ?? 1;
      duration = Math.max(duration, t0 + (burst ? Math.max(...(L.emit?.bursts ?? [{ t: 0 }]).map(b => b.t ?? 0)) : L.emit?.duration ?? effect.duration ?? 1) + life);
    } else if (L.type === 'beam' || L.type === 'trail') {
      const a0 = att(ln + 'A0', L.a0 ?? [0, 0, 0]), a1 = att(ln + 'A1', L.a1 ?? [0, 4, 0]), cls = L.type === 'beam' ? 'Beam' : 'Trail';
      add(root, inst(cls, ln, classProps(cls, { ...L.props, Enabled: false }, { Attachment0: T.ref(a0), Attachment1: T.ref(a1), Texture: T.content(resolveTexture(L.texture, assets)) })));
      const path = `Root/${ln}`; layerPath.set(L, path);
      events.push({ t: t0, kind: 'enable', target: path, on: true }); const end = t0 + (L.duration ?? effect.duration ?? 1); events.push({ t: end, kind: 'enable', target: path, on: false });
      duration = Math.max(duration, end + (cls === 'Trail' ? (L.props?.Lifetime ?? 0.5) : 0));
      if (L.motion) for (const [i, m] of L.motion.entries()) events.push({ t: t0 + (m.t ?? 0), kind: 'anim', target: `Root/${ln}${m.attachment ?? 'A1'}`, prop: 'Position', type: 'vector3', from: m.from, to: m.to, dur: m.dur ?? 0.3, style: m.style, dir: m.dir, i });
    } else if (L.type === 'light') {
      const cls = LIGHTS.includes(L.class) ? L.class : 'PointLight';
      add(root, inst(cls, ln, classProps(cls, { ...L.props, Enabled: false })));
      const path = `Root/${ln}`; layerPath.set(L, path); events.push({ t: t0, kind: 'enable', target: path, on: true });
      const end = t0 + (L.duration ?? effect.duration ?? 1); events.push({ t: end, kind: 'enable', target: path, on: false }); duration = Math.max(duration, end);
    } else if (L.type === 'mesh') {
      const shape = L.shape ?? 'Ball', part = inst('Part', ln, {
        Anchored: T.bool(true), CanCollide: T.bool(false), CanQuery: T.bool(false), CanTouch: T.bool(false), CastShadow: T.bool(false), Locked: T.bool(true),
        Transparency: T.float(L.transparency ?? 1), size: T.vec3(L.size ?? [1, 1, 1]), CFrame: T.cframe(L.offset ?? [0, 0, 0], L.rotation),
        Material: T.enum(ENUM.Material[L.material ?? 'Neon'] ?? ENUM.Material.Neon), Color3uint8: T.color3u8(L.color ?? '#ffffff'), shape: T.enum(ENUM.PartType[shape] ?? 0) });
      if (L.meshId || L.specialMesh) add(part, inst('SpecialMesh', 'Mesh', { MeshType: T.enum(L.meshId ? ENUM.MeshType.FileMesh : ENUM.MeshType[L.specialMesh] ?? 3), MeshId: T.content(L.meshId ? `rbxassetid://${String(L.meshId).replace(/\D/g, '')}` : ''), TextureId: T.content(resolveTexture(L.texture, assets)), Scale: T.vec3(L.meshScale ?? [1, 1, 1]), Offset: T.vec3([0, 0, 0]), VertexColor: T.vec3([1, 1, 1]) }));
      add(folder, part); const path = ln; layerPath.set(L, path);
      part.offset = L.offset ?? [0, 0, 0]; part.rotationSpec = L.rotation;
    } else if (L.type === 'highlight') {
      add(folder, inst('Highlight', ln, classProps('Highlight', { ...L.props, Enabled: false })));
      const path = ln; layerPath.set(L, path); events.push({ t: t0, kind: 'enable', target: path, on: true });
      const end = t0 + (L.duration ?? effect.duration ?? 1); events.push({ t: end, kind: 'enable', target: path, on: false }); duration = Math.max(duration, end);
    } else if (L.type === 'post') {
      const cls = POST.includes(L.class) ? L.class : 'BloomEffect';
      add(folder, inst(cls, ln, classProps(cls, { ...L.props, Enabled: false })));
      const path = ln; layerPath.set(L, path); events.push({ t: t0, kind: 'enable', target: path, on: true });
      const end = t0 + (L.duration ?? effect.duration ?? 0.5); events.push({ t: end, kind: 'enable', target: path, on: false }); duration = Math.max(duration, end);
    }
    // Property animations (mesh size/transparency/color, light brightness/range, beam width, post intensity …)
    for (const a of L.anim ?? []) {
      const path = layerPath.get(L); if (!path) continue;
      const type = Array.isArray(a.to) && a.to.length === 3 ? (a.prop === 'Color' ? 'color3' : 'vector3') : typeof a.to === 'string' ? 'color3' : 'number';
      const conv = v => type === 'color3' && typeof v === 'string' ? hexRGB(v) : v;
      events.push({ t: t0 + (a.delay ?? 0), kind: 'anim', target: path, prop: a.prop, type, from: conv(a.from), to: conv(a.to), dur: a.time ?? 0.4, style: a.style ?? 'Quad', dir: a.dir ?? 'Out' });
      duration = Math.max(duration, t0 + (a.delay ?? 0) + (a.time ?? 0.4));
    }
  }
  events.sort((a, b) => a.t - b.t);
  add(folder, inst('StringValue', 'Timeline', { Value: T.string(JSON.stringify({ duration: +duration.toFixed(3), loop: !!effect.loop, events })) }));
  // Mesh parts keep their offset from Root in a CodexOffset CFrameValue (the controller re-places them every frame).
  for (const c of folder.children) if (c.className === 'Part' && c.offset) { add(c, inst('CFrameValue', 'CodexOffset', { Value: T.cframe(c.offset, c.rotationSpec) })); delete c.offset; delete c.rotationSpec; }
  return { folder, duration, events };
}

/** Package: Folder CodexVFX { ModuleScript VFXStudio { Folder Effects {…} } , StringValue Manifest } */
export function buildPackage(effects, { assets = {}, controller, manifest = {} } = {}) {
  if (!controller) throw new Error('buildPackage needs the controller source (src/rbx/vfx-controller.luau)');
  const fx = inst('Folder', 'Effects', {}, effects.map(e => buildEffect(e, { assets }).folder));
  const module = inst('ModuleScript', 'VFXStudio', { Source: T.source(controller) }, [fx]);
  return inst('Folder', 'CodexVFX', {}, [module, inst('StringValue', 'Manifest', { Value: T.string(JSON.stringify({ ...META, generator: 'Codex Design VFX Studio', effects: effects.map(e => e.name), ...manifest })) })]);
}

export const safeName = s => String(s).replace(/[^A-Za-z0-9_ -]/g, '').trim().replace(/\s+/g, '') || 'Effect';
const hexRGB = h => { const f = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255); };

/** Every texture an effect needs: [{key, layer, src|generated}]. */
export function textureRefs(effect) {
  const out = [];
  for (const L of effect.layers ?? []) if (L.enabled !== false && L.texture && !L.texture.assetId) out.push({ key: textureKey(L.texture), layer: L.name ?? L.type, ...L.texture });
  return out;
}

// ---------- Validator ----------
const BUDGET = { particles: 400, mobileParticles: 150, emitters: 12, lights: 3, beams: 8, textures: 8 };
/** Returns [{level:'error'|'warn'|'info', code, layer, message}]. Errors block export (unless placeholders are chosen). */
export function validateEffect(effect, { assets = {}, textureInfo = {}, mobile = true } = {}) {
  const issues = [], push = (level, code, message, layer) => issues.push({ level, code, message, layer });
  if (!effect.name) push('error', 'name', 'Effect needs a name');
  if (!(effect.layers ?? []).length) push('error', 'empty', 'Effect has no layers');
  const names = new Set(); let particles = 0, emitters = 0, lights = 0, beams = 0;
  for (const L of effect.layers ?? []) {
    const ln = L.name ?? L.type, cls = { emitter: 'ParticleEmitter', beam: 'Beam', trail: 'Trail', light: L.class ?? 'PointLight', highlight: 'Highlight', post: L.class ?? 'BloomEffect' }[L.type];
    if (!LAYER_TYPES.includes(L.type)) { push('error', 'type', `Unknown layer type "${L.type}" (Roblox VFX Studio exports only Roblox classes)`, ln); continue; }
    if (L.enabled === false) continue;
    if (names.has(safeName(ln))) push('error', 'dup-name', `Two layers are named "${ln}"; the timeline addresses layers by name`, ln); names.add(safeName(ln));
    for (const k of Object.keys(L.props ?? {})) if (cls && !ALLOWED[cls]?.has(k)) push('error', 'unsupported-prop', `${cls} has no property "${k}" (not exported as if Roblox supported it)`, ln);
    if (cls && L.props) for (const [k, v] of Object.entries(L.props)) { try { serialize(cls, k, v); } catch (e) { push('error', 'bad-value', e.message, ln); } }
    if (L.shader || L.glsl) push('error', 'shader', 'Custom shaders cannot run in Roblox; bake the look into a texture/flipbook instead', ln);
    if (['emitter', 'beam', 'trail'].includes(L.type)) {
      if (!L.texture) push('warn', 'no-texture', `${cls} has no texture (Roblox default sparkles will show)`, ln);
      else if (!resolveTexture(L.texture, assets)) push('error', 'missing-asset-id', `Texture ${textureKey(L.texture)} has no Roblox asset id yet (upload it or use the Studio importer)`, ln);
      const info = textureInfo[textureKey(L.texture)];
      if (info && (info.width > 1024 || info.height > 1024)) push('error', 'texture-size', `Texture is ${info.width}×${info.height}; Roblox downsizes above 1024×1024`, ln);
      if (info && (info.width & (info.width - 1))) push('warn', 'texture-pot', 'Texture side is not a power of two; flipbook cells will blur', ln);
    }
    if (L.type === 'emitter') {
      emitters++; const p = { ...DEFAULTS.ParticleEmitter, ...L.props }, life = Array.isArray(p.Lifetime) ? p.Lifetime : [p.Lifetime, p.Lifetime];
      if (life[0] <= 0 || life[1] > 20) push('error', 'lifetime', `Lifetime ${life.join('–')} s out of range (0 < life ≤ 20)`, ln);
      if (life[0] > life[1]) push('error', 'lifetime-order', 'Lifetime min is larger than max', ln);
      const burst = (L.emit?.mode ?? 'burst') === 'burst', n = burst ? (L.emit?.bursts ?? [{ count: L.emit?.count ?? 20 }]).reduce((s, b) => s + (b.count ?? 20), 0) : p.Rate * life[1];
      particles += n; if (!burst && p.Rate > 500) push('warn', 'rate', `Rate ${p.Rate}/s is very high`, ln);
      if (p.FlipbookLayout !== 'None') {
        const grid = { Grid2x2: 2, Grid4x4: 4, Grid8x8: 8 }[p.FlipbookLayout];
        if (p.FlipbookLayout === 'Custom') push('info', 'flipbook-custom', 'Custom flipbook layout (FlipbookSizeX/Y) needs a recent Roblox client; Grid layouts work everywhere', ln);
        else if (!grid) push('error', 'flipbook-layout', `Unknown FlipbookLayout ${p.FlipbookLayout}`, ln);
        const tg = L.texture?.grid; if (grid && tg && tg !== grid) push('error', 'flipbook-mismatch', `Texture is a ${tg}×${tg} atlas but FlipbookLayout is ${p.FlipbookLayout}`, ln);
        // OneShot spans each particle's lifetime (framerate ignored); Loop/PingPong/Random use FlipbookFramerate.
        if (p.FlipbookMode !== 'OneShot' && !(Array.isArray(p.FlipbookFramerate) ? p.FlipbookFramerate[0] : p.FlipbookFramerate)) push('error', 'flipbook-rate', 'FlipbookFramerate must be > 0 for Loop/PingPong/Random', ln);
      }
      if (p.LightEmission > 0 && p.LightInfluence > 0.5) push('info', 'light-mix', 'Additive (LightEmission) with high LightInfluence darkens at night; glows usually use LightInfluence 0', ln);
    }
    if (L.type === 'light') { lights++; if ((L.props?.Range ?? 12) > 60) push('error', 'light-range', 'Light Range is capped at 60 studs in Roblox', ln); if (L.props?.Shadows) push('warn', 'light-shadows', 'Shadow-casting lights are expensive on mobile', ln); }
    if (L.type === 'beam' || L.type === 'trail') { beams++; if (!L.a0 && !L.a1 && L.type === 'beam') push('info', 'beam-default', 'Beam uses default attachments (0,0,0)→(0,4,0)', ln); }
    if (L.type === 'mesh' && L.meshId && !/^\d+$/.test(String(L.meshId).replace('rbxassetid://', ''))) push('error', 'mesh-id', 'meshId must be a Roblox mesh asset id', ln);
    if (L.type === 'post') push('info', 'post', `${L.class ?? 'BloomEffect'} affects the whole screen while active (parented to Lighting)`, ln);
    for (const a of L.anim ?? []) {
      if ((a.time ?? 0.4) <= 0) push('error', 'anim-time', `Animation of ${a.prop} has no duration`, ln);
      if (a.style && !['Linear', 'Sine', 'Back', 'Quad', 'Quart', 'Quint', 'Bounce', 'Elastic', 'Exponential', 'Circular', 'Cubic'].includes(a.style)) push('error', 'anim-style', `Unknown EasingStyle ${a.style}`, ln);
    }
  }
  if (particles > BUDGET.particles) push('warn', 'budget', `~${Math.round(particles)} live particles; aim for ≤ ${BUDGET.particles} (PC)`);
  if (mobile && particles > BUDGET.mobileParticles) push('warn', 'mobile', `~${Math.round(particles)} particles is heavy on mobile (≤ ${BUDGET.mobileParticles}); Quality "Auto" scales bursts down`);
  if (emitters > BUDGET.emitters) push('warn', 'emitters', `${emitters} emitters; merge layers where possible`);
  if (lights > BUDGET.lights) push('warn', 'lights', `${lights} dynamic lights; Roblox mobile shows few at once`);
  try { buildEffect(effect, { assets }); } catch (e) { push('error', 'build', e.message); }
  return issues;
}
