// Example of an AI-authored PBR material (not a preset): weathered castle blocks with moss in the crevices.
// Export: npm run texture -- textures/mossy-castle-stone.js --size 4096
// In a recipe: k.pbrSurface((await import('../textures/mossy-castle-stone.js')).default, {size:1024, repeat:2})
import { bricks, fbm, ridged, cells, ramp, mix, smooth, warp } from '../src/texlab.js';

export default {
  name: 'mossy-castle-stone',
  note: 'Large irregular stone blocks, chipped edges, moss growing from the mortar upward',
  normal: 7,
  height(u, v, seed) {
    const [wu, wv] = warp(u, v, 0.03, 4, seed);
    const b = bricks(wu, wv, { rows: 5, cols: 3, mortar: 0.05, bevel: 0.12, jitter: 0.25, seed });
    const chips = ridged(u, v, 6, 4, seed + 3) * 0.35, pores = cells(u, v, 32, seed + 5).f1 < 0.12 ? -0.08 : 0;
    const h = b.mask ? 0.45 + b.bevel * 0.4 + fbm(u, v, 8, 5, seed + 1) * 0.2 - chips * (1 - b.bevel) + pores : 0.08 + fbm(u, v, 16, 3, seed + 2) * 0.1;
    // id = per-block tone, mask = moss amount (in the mortar and on the lower lip of each block)
    return { h, id: b.id, mask: b.mask ? smooth(0.25, 0, b.lv) * smooth(0.55, 0.85, fbm(u, v, 6, 4, seed + 9)) : 1 };
  },
  albedo(c) {
    const stone = ramp([[0, '#4b4a52'], [0.5, '#7b7a80'], [1, '#a7a4a0']], 0.25 + c.id * 0.5 + c.n * 0.25);
    const moss = ramp([[0, '#2d4a17'], [1, '#6f9a2a']], c.n);
    const col = mix(stone, moss, Math.min(1, c.mask * 0.9)).map(x => x * (1 + c.cavity * 1.4) * (1 + c.edge * 0.5));
    return col;
  },
  roughness: c => 0.82 + c.mask * 0.12 - c.edge * 0.2,
};
