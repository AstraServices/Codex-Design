// Procedural PBR texture library preview: one rounded tile per preset (albedo + normal + ORM maps).
export function build(k) {
  const names = k.PBR_EXAMPLES, cols = 5;
  names.forEach((name, i) => {
    const mat = k.pbrSurface(name, { size: k.parameters.resolution });
    const id = name.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    k.mesh(`Swatch_${id}`, 'roundedBox', [0.9, 0.9, 0.12, 3, 0.03], mat, { at: [(i % cols - (cols - 1) / 2) * 1.05, 0.55 + (Math.floor((names.length - 1) / cols) - Math.floor(i / cols)) * 1.05, 0] });
  });
}
