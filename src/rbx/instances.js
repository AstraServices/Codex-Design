// Roblox instance trees for the RBXMX (XML) and RBXM (binary) writers. Isomorphic: runs in the browser and in Node.
// An instance is {className, name, props:{Name:{type,value}}, children:[]}; build them with inst() and the T.* types.
// Every type maps 1:1 to a Roblox property type, so the writers never guess.

export const T = {
  string: v => ({ type: 'string', value: String(v ?? '') }),
  source: v => ({ type: 'source', value: String(v ?? '') }),       // ProtectedString (Script.Source)
  content: v => ({ type: 'content', value: String(v ?? '') }),     // ContentId: rbxassetid://123 or ''
  bool: v => ({ type: 'bool', value: !!v }),
  int: v => ({ type: 'int', value: Math.trunc(v ?? 0) }),
  float: v => ({ type: 'float', value: +(v ?? 0) }),
  enum: v => ({ type: 'enum', value: v >>> 0 }),
  color3: c => ({ type: 'color3', value: toRGB(c) }),
  color3u8: c => ({ type: 'color3u8', value: toRGB(c).map(x => Math.max(0, Math.min(255, Math.round(x * 255)))) }), // BasePart.Color3uint8
  vec2: v => ({ type: 'vec2', value: [+v[0], +v[1]] }),
  vec3: v => ({ type: 'vec3', value: [+v[0], +v[1], +v[2]] }),
  /** CFrame from position [x,y,z] and optional 3x3 rotation (row-major) or Euler degrees {rx,ry,rz}. */
  cframe: (p = [0, 0, 0], rot) => ({ type: 'cframe', value: { p: [+p[0], +p[1], +p[2]], r: rotation(rot) } }),
  ref: target => ({ type: 'ref', value: target ?? null }),
  /** NumberSequence keypoints [[time, value, envelope?], …]; first time 0, last time 1 (Roblox rule). */
  numseq: k => ({ type: 'numseq', value: sequence(typeof k === 'number' ? [[0, k], [1, k]] : k).map(([t, v, e = 0]) => [t, +v, +e]) }),
  /** ColorSequence keypoints [[time, '#hex'|[r,g,b]], …]. */
  colseq: k => ({ type: 'colseq', value: sequence(typeof k === 'string' || (Array.isArray(k) && typeof k[0] === 'number') ? [[0, k], [1, k]] : k).map(([t, c]) => [t, toRGB(c)]) }),
  numrange: (a, b = a) => ({ type: 'numrange', value: [+a, +b] }),
};

/** Sorts keypoints and pins them to 0 and 1 (NumberSequence/ColorSequence must start at 0 and end at 1). */
function sequence(k) {
  const s = [...k].map(p => [...p]).sort((a, b) => a[0] - b[0]);
  if (!s.length) throw new Error('Empty sequence');
  if (s[0][0] !== 0) s.unshift([0, ...s[0].slice(1)]);
  if (s.at(-1)[0] !== 1) s.push([1, ...s.at(-1).slice(1)]);
  return s.slice(0, 20); // Roblox allows at most 20 keypoints
}
export function toRGB(c) {
  if (Array.isArray(c)) return c.map(Number);
  const h = String(c).replace('#', ''), f = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255);
}
function rotation(rot) {
  if (!rot) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (Array.isArray(rot)) return rot.map(Number);
  const d = Math.PI / 180, [x, y, z] = [(rot.rx ?? 0) * d, (rot.ry ?? 0) * d, (rot.rz ?? 0) * d];
  // Roblox CFrame.Angles order: R = Rx * Ry * Rz
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  return [cy * cz, -cy * sz, sy, cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy, sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy];
}

export function inst(className, name, props = {}, children = []) {
  const node = { className, name: name ?? className, props: { Name: T.string(name ?? className), ...props }, children: [] };
  for (const c of children) add(node, c);
  return node;
}
export function add(parent, child) { if (child) { child.parent = parent; parent.children.push(child); } return child; }

/** Depth-first list of every instance (parents before children). */
export function flatten(roots) { const out = []; const walk = n => { out.push(n); n.children.forEach(walk); }; (Array.isArray(roots) ? roots : [roots]).forEach(walk); return out; }

/** Roblox enum values used by the studios (Enum.X.Y → number). */
export const ENUM = {
  FlipbookLayout: { None: 0, Grid2x2: 1, Grid4x4: 2, Grid8x8: 3, Custom: 4 },
  FlipbookMode: { Loop: 0, OneShot: 1, PingPong: 2, Random: 3 },
  ParticleOrientation: { FacingCamera: 0, FacingCameraWorldUp: 1, VelocityParallel: 2, VelocityPerpendicular: 3 },
  NormalId: { Right: 0, Top: 1, Back: 2, Left: 3, Bottom: 4, Front: 5 },
  ParticleEmitterShape: { Box: 0, Sphere: 1, Cylinder: 2, Disc: 3 },
  ParticleEmitterShapeStyle: { Volume: 0, Surface: 1 },
  ParticleEmitterShapeInOut: { Outward: 0, Inward: 1, InAndOut: 2 },
  TextureMode: { Stretch: 0, Wrap: 1, Static: 2 },
  Material: { Plastic: 256, SmoothPlastic: 272, Neon: 288, Glass: 1568, ForceField: 1584, Foil: 1040, Metal: 1088 },
  PartType: { Ball: 0, Block: 1, Cylinder: 2, Wedge: 3, CornerWedge: 4 },
  MeshType: { Head: 0, Torso: 1, Wedge: 2, Sphere: 3, Cylinder: 4, FileMesh: 5, Brick: 6, Prism: 7, Pyramid: 8, ParallelRamp: 9, RightAngleRamp: 10, CornerWedge: 11 },
  NormalMapFormat: { OpenGL: 0, DirectX: 1 }, // not stored: Roblox SurfaceAppearance expects OpenGL (+Y)
  AlphaMode: { Overlay: 0, Transparency: 1, TintMask: 2 },
};
