// Stud Nature pine (GradientTrain style): stacked stud-block canopy tiers, a tapering trunk and blocky roots.
// One voxel mesh, StudTrain studs, bright face rims + inner vignette + voxel AO baked into a single texture,
// then a model-wide gradient (dark base → light top). No highlight, no outline, no animation: a static prop.
export async function build(k) {
  const p = k.parameters, tiers = Math.round(p.tiers), R = Math.round(p.width / 2);
  const trunkH = 4, tierH = 2, top = trunkH + tiers * tierH + 2;
  // Tier i shrinks toward the top; the lowest tier overhangs most (as in the reference trees).
  const tierHalf = i => Math.max(1, Math.round(R - i * (R - 1) / Math.max(1, tiers - 1)));
  const fill = (x, y, z) => {
    const dx = x - R, dz = z - R;
    if (y < trunkH) { // trunk widens into roots at the base
      const w = y === 0 ? 2 : y === 1 ? 1 : 0;
      if (Math.abs(dx) <= w + 0.5 && Math.abs(dz) <= 0.5 + (y === 0 ? 0 : 0.5) || (y === 0 && Math.abs(dz) <= 2 && Math.abs(dx) <= 0.5)) return p.bark;
      return Math.abs(dx) <= 0.5 && Math.abs(dz) <= 0.5 ? p.bark : null;
    }
    const t = Math.floor((y - trunkH) / tierH);
    if (t < tiers) { const h = tierHalf(t); return Math.abs(dx) <= h && Math.abs(dz) <= h ? p.leaves : null; }
    return y < top && Math.abs(dx) <= 0 && Math.abs(dz) <= 0 ? p.leaves : null; // tip
  };
  await k.voxels('Pine', { size: [R * 2 + 1, top, R * 2 + 1], fill, voxel: k.STUD, studs: 'train' });
  // Designed color ramp for the canopy (deep shade → measured leaf green → sunlit tips), then the measured light gradient.
  await k.gradient('Pine', { type: 'linear', from: 'bottom', to: 'top', space: 'part', mode: 'tint', amount: 0.55, only: [p.leaves], stops: [[0, '#0f3b16'], [0.55, p.leaves], [1, '#9be35a']] });
  await k.gradient('Asset', { bottom: p.gradientBottom, top: p.gradientTop, tint: 0.12, tintBottom: '#20194a', tintTop: '#fff4c8' });
}
