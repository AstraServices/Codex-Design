import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Viewer lighting rig. Light directions are camera-relative (x right, y up, z toward the camera) and follow the
// camera's orbit, so the key always lights the visible side and the rim always separates the silhouette.
// Contrast comes from a strong key, low ambient/environment, a dark contact shadow and screen-space AO.
const TONE = { ACES: THREE.ACESFilmicToneMapping, AgX: THREE.AgXToneMapping, Neutral: THREE.NeutralToneMapping, None: THREE.NoToneMapping };
export const LIGHTING_PRESETS = {
  studio: { label: 'Studio', tone: 'ACES', exposure: 0.95, env: 0.22, hemi: ['#eaf2ff', '#2e281d', 0.3], key: ['#fff0d8', 6.8, [0.65, 0.85, 0.6]], fill: ['#b9cfff', 0.55, [-0.9, 0.15, 0.4]], rim: ['#f2f7ff', 6, [-0.4, 0.5, -1]], shadow: 0.6, contact: 0.65, ao: 1.35 },
  dramatic: { label: 'Dramatic', tone: 'ACES', exposure: 0.95, env: 0.1, hemi: ['#b9c8ff', '#140f0a', 0.12], key: ['#ffe2bd', 8.5, [0.85, 0.65, 0.35]], fill: ['#7f9bff', 0.22, [-0.9, 0.1, 0.4]], rim: ['#a8d4ff', 8, [-0.5, 0.45, -1]], shadow: 0.75, contact: 0.75, ao: 1.4 },
  soft: { label: 'Soft', tone: 'AgX', exposure: 1.2, env: 0.75, hemi: ['#f4f8ff', '#4a4338', 0.75], key: ['#fff6ea', 3.2, [0.4, 1, 0.8]], fill: ['#dfe8ff', 1.3, [-0.8, 0.35, 0.6]], rim: ['#ffffff', 2.4, [-0.2, 0.6, -1]], shadow: 0.32, contact: 0.45, ao: 0.85 },
  sunset: { label: 'Sunset', tone: 'ACES', exposure: 1.0, env: 0.22, hemi: ['#ffc9a0', '#241e3a', 0.4], key: ['#ffad6b', 6.5, [0.95, 0.32, 0.3]], fill: ['#6c7dff', 0.75, [-0.9, 0.25, 0.4]], rim: ['#ff8758', 6, [-0.6, 0.35, -1]], shadow: 0.65, contact: 0.65, ao: 1.2 },
  roblox: { label: 'Roblox day', tone: 'ACES', exposure: 1.05, env: 0.5, hemi: ['#cfe6ff', '#6b5a3c', 0.7], key: ['#ffffff', 5, [0.35, 1, 0.45]], fill: ['#dbe9ff', 0.5, [-0.8, 0.3, 0.5]], rim: ['#ffffff', 1.8, [-0.3, 0.5, -1]], shadow: 0.55, contact: 0.5, ao: 0.75 },
  classic: { label: 'Classic (v0.3)', tone: 'ACES', exposure: 1.2, env: 1, hemi: ['#f6ffe6', '#304438', 2], key: ['#ffefd8', 4, [0.45, 0.75, 0.65]], fill: ['#ffffff', 0, [-1, 0, 0]], rim: ['#d9efce', 3, [-0.65, 0.5, -0.5]], shadow: 0.25, contact: 0, ao: 0 },
};
export const DEFAULT_LIGHTING = 'studio';

function contactTexture() {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1, r = Math.min(1, Math.hypot(dx, dy));
    const a = Math.pow(1 - r, 2.2) * (1 - r * r), i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0; data[i + 3] = Math.round(255 * a);
  }
  const t = new THREE.DataTexture(data, size, size); t.needsUpdate = true; t.magFilter = t.minFilter = THREE.LinearFilter; return t;
}

export class LightingRig {
  constructor(renderer, scene, fx) {
    this.renderer = renderer; this.scene = scene; this.fx = fx; this.center = new THREE.Vector3(); this.radius = 1; this.floorY = -0.1;
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    this.envTexture = pmrem.fromScene(room, 0.04).texture; scene.environment = this.envTexture; room.dispose(); pmrem.dispose();
    this.hemi = new THREE.HemisphereLight(); scene.add(this.hemi);
    const light = shadow => { const l = new THREE.DirectionalLight(); l.castShadow = shadow; scene.add(l, l.target); return l; };
    this.key = light(true); this.fill = light(false); this.rim = light(false);
    this.key.shadow.mapSize.set(2048, 2048);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.5 }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.receiveShadow = true; this.floor.name = '_ViewerFloor';
    this.contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x000000, map: contactTexture(), transparent: true, depthWrite: false, toneMapped: false }));
    this.contact.rotation.x = -Math.PI / 2; this.contact.renderOrder = -1; this.contact.name = '_ViewerContactShadow';
    scene.add(this.floor, this.contact);
    this.apply(DEFAULT_LIGHTING);
  }
  /** name of a preset, or {preset, exposure, env, key, ao, ...} overrides. Returns the active settings. */
  apply(spec = DEFAULT_LIGHTING) {
    const base = typeof spec === 'string' ? spec : spec.preset ?? this.name ?? DEFAULT_LIGHTING;
    if (!LIGHTING_PRESETS[base]) throw new Error(`Unknown lighting preset "${base}". Use: ${Object.keys(LIGHTING_PRESETS).join(', ')}`);
    const s = { ...LIGHTING_PRESETS[base], ...(typeof spec === 'object' ? spec : {}) }; delete s.preset;
    this.name = base; this.settings = s;
    const r = this.renderer; r.toneMapping = TONE[s.tone] ?? THREE.ACESFilmicToneMapping; r.toneMappingExposure = s.exposure;
    this.scene.environmentIntensity = s.env;
    this.hemi.color.set(s.hemi[0]); this.hemi.groundColor.set(s.hemi[1]); this.hemi.intensity = s.hemi[2];
    for (const [l, [color, intensity]] of [[this.key, s.key], [this.fill, s.fill], [this.rim, s.rim]]) { l.color.set(color); l.intensity = intensity; l.visible = intensity > 0; }
    this.floor.material.opacity = s.shadow; this.contact.material.opacity = s.contact; this.contact.visible = s.contact > 0;
    this.fx.ao.strength = s.ao; this.fx.ao.enabled = s.ao > 0;
    // Tone-mapping changes need recompiled programs.
    this.scene.traverse(o => { if (o.material) for (const m of [o.material].flat()) m.needsUpdate = true; });
    return { preset: base, ...s };
  }
  /** Fit floor, contact shadow, shadow frustum and AO radius to the asset bounds. */
  fit(box) {
    const size = box.getSize(new THREE.Vector3()); box.getCenter(this.center);
    this.radius = Math.max(size.length() / 2, 0.1); this.floorY = box.min.y - 0.012;
    this.floor.position.y = this.floorY; this.contact.position.set(this.center.x, this.floorY + this.radius * 0.002, this.center.z);
    const footprint = Math.max(size.x, size.z, 0.1) * 1.7; this.contact.scale.set(footprint, footprint, 1);
    const cam = this.key.shadow.camera, r = this.radius * 1.25;
    cam.left = cam.bottom = -r; cam.right = cam.top = r; cam.near = this.radius * 0.05; cam.far = this.radius * 8; cam.updateProjectionMatrix();
    this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = this.radius * 0.012;
    this.fx.ao.radius = THREE.MathUtils.clamp(this.radius * 0.12, 0.01, 2);
  }
  /** Re-aim the lights around the camera's azimuth. Call once per frame. */
  update(camera) {
    const off = camera.position.clone().sub(this.center), a = Math.atan2(off.x, off.z), c = Math.cos(a), s = Math.sin(a), d = new THREE.Vector3();
    for (const [l, dir] of [[this.key, this.settings.key[2]], [this.fill, this.settings.fill[2]], [this.rim, this.settings.rim[2]]]) {
      d.set(dir[0] * c + dir[2] * s, dir[1], -dir[0] * s + dir[2] * c).normalize();
      l.target.position.copy(this.center); l.position.copy(this.center).addScaledVector(d, this.radius * 4);
    }
  }
}
