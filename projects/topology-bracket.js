// Engineering topology optimization (SIMP): a wall bracket that carries a tip load with 35% of the material.
// The solver finds the load paths; the density field is traced and extruded into a lightweight solid.
export function build(k) {
  const p = k.parameters;
  const part = k.topologyPart('Bracket', { case: p.loadCase, nelx: 72, nely: 36, volfrac: p.volume, rmin: 1.6, iterations: 60, size: 2, thickness: 0.18, color: p.color, at: [0, 0.6, 0] });
  // Wall plate the bracket is bolted to (left edge), for context.
  k.mesh('WallPlate', 'box', [0.08, 1.2, 0.5], k.material('#4a5058', { roughness: 0.7, metalness: 0.3 }), { at: [-1.04, 0.6, 0] });
  part.userData.note = `compliance ${part.topology.compliance.toFixed(2)} · volume ${(part.topology.volume * 100).toFixed(0)}% · ${part.topology.iterations} iterations`;
}
