// Simulator egg (Train/StudGradientModelKarisik/543256.png): ovoid ≈1.3× taller than wide, themed surface + attachments.
// The surface of each theme is written here with the painter (model-aware texture), not picked from a library.
// Static prop: no animation, no highlight.
export async function build(k) {
  const p = k.parameters, R = p.radius, H = R * 2.6, T = k.tex;
  // Egg profile: wider low, narrower high; 24 segments around (multiple of 4 → clean caps).
  const prof = []; for (let i = 0; i <= 24; i++) { const t = i / 24, a = t * Math.PI, y = (1 - Math.cos(a)) / 2 * H, r = Math.sin(a) * R * (1 - 0.18 * t); prof.push([Math.max(r, 0.0001), y]); }
  const egg = k.mesh('Egg', 'lathe', [prof, 32], k.material('#ffffff'), { at: [0, R * 0.25, 0] });
  const look = { rim: 0, glow: 0, vignette: 0, faceGradient: 0, ao: 0, hardAngle: 80 };
  // Round stars: nearest jittered point of a 3D cell grid, a soft disc around it.
  const star3 = c => { const g = 26, x = c.part.x * g, y = c.part.y * g, z = c.part.z * g, ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), h = T.hash(ix + iz * 7919, iy, 3); if (h < 0.93) return 0; const px = ix + T.hash(ix, iy + iz, 5), py = iy + T.hash(iy, ix + iz, 6), pz = iz + T.hash(iz, ix + iy, 7); return 1 - T.smooth(0.08, 0.2, Math.hypot(x - px, y - py, z - pz)); };
  if (p.theme === 'lava') {
    // Dark basalt plates separated by glowing cracks (Voronoi in the egg's own surface coordinates).
    await k.paint(egg, { look, painter: {
      albedo: c => { const v = T.cells(c.part.x * 0.9 + 3, c.part.y * 0.7 + c.part.z * 0.6 + 3, 6, 4); const crack = 1 - T.smooth(0.03, 0.09, v.edge); const rock = T.ramp([[0, '#120c0c'], [1, '#3b2a26']], v.id * 0.6 + c.modelY * 0.4); return T.mix(rock, T.ramp([[0, '#ff3b00'], [1, '#ffd25a']], c.modelY), crack); },
      emissive: c => { const v = T.cells(c.part.x * 0.9 + 3, c.part.y * 0.7 + c.part.z * 0.6 + 3, 6, 4); const crack = 1 - T.smooth(0.03, 0.09, v.edge); return [1 * crack, 0.35 * crack, 0.05 * crack]; },
      roughness: c => 0.85, height: c => T.smooth(0.02, 0.12, T.cells(c.part.x * 0.9 + 3, c.part.y * 0.7 + c.part.z * 0.6 + 3, 6, 4).edge), bump: 3,
    } });
  } else if (p.theme === 'galaxy') {
    // Deep space gradient (bottom indigo → top violet), swirled nebula and sparse stars, plus an orbit ring.
    await k.paint(egg, { look, gradient: { type: 'linear', from: 'bottom', to: 'top', stops: [[0, '#140a3a'], [0.6, '#3a1a8a'], [1, '#7a3bd9']] }, painter: {
      albedo: (c, col) => { const n = T.fbm(c.part.x * 0.8 + 5, c.part.y * 0.6 + c.part.z * 0.5, 4, 4, 9); const star = star3(c); return T.mix(T.mix(col, [0.85, 0.35, 0.95], T.smooth(0.55, 0.8, n) * 0.6), [1, 0.95, 0.8], star); },
      emissive: c => { const star = star3(c); return [star, star * 0.9, star * 0.6]; }, roughness: () => 0.3,
    } });
    const ring = k.mesh('Ring', 'torus', [R * 1.45, R * 0.06, 12, 64], k.material('#f2c14e', { metalness: 0.8, roughness: 0.25 }), { at: [0, R * 0.25 + H * 0.5, 0], rotate: [Math.PI / 2 - 0.35, 0, 0.2] });
    await k.paint(ring, { look: { rim: 0.4, rimLighten: 0.4, vignette: 0 }, gradient: { type: 'angular', axis: 'y', stops: [[0, '#ffe08a'], [0.5, '#c98a12'], [1, '#ffe08a']] }, metalness: 0.8, roughness: 0.25 });
  } else {
    // Crystal: icy egg (designed vertical gradient) with shards around the base.
    await k.paint(egg, { look, gradient: { type: 'linear', from: 'bottom', to: 'top', stops: [[0, '#163f9e'], [0.45, '#2f86e8'], [0.8, '#79c9ff'], [1, '#d9f6ff']] }, roughness: 0.35 });
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2 + (i % 2) * 0.2, h = R * (0.8 + (i % 3) * 0.35), shard = k.mesh(`Shard${i}`, 'cylinder', [0.01, R * 0.22, h, 6, 1], k.material('#7cc8ff'), { at: [Math.cos(a) * R * 0.95, h / 2, Math.sin(a) * R * 0.95], rotate: [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35] });
      await k.paint(shard, { look: { rim: 0.6, rimWidth: 0.04, rimLighten: 0.55, vignette: 0.15 }, gradient: { type: 'linear', from: 'bottom', to: 'top', space: 'part', stops: [[0, '#1d4f8f'], [1, '#d9f6ff']] }, roughness: 0.1 });
    }
  }
}
