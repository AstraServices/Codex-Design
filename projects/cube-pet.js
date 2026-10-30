// Simulator cube pet (Train/StudGradientModelKarisik: 865, 8658, 78568, 9789). Construction rules learned there:
// rounded cube body ≈ 1 : 0.9 : 0.9, face on the front, eyes ≈ 32% of the face width each with two highlights,
// small cone ears with a lighter inner ear, four stub legs ≈ 18% of the body height, a fluffy tail.
// Tiers reuse the same mesh; only the gradient/look you design changes. Static prop: no animation, no highlight.
export async function build(k) {
  const p = k.parameters, s = p.size;
  const body = k.mesh('Body', 'roundedBox', [s, s * 0.9, s * 0.9, 4, s * 0.16], k.material(p.fur), { at: [0, s * 0.18 + s * 0.45, 0] });
  // Fur: designed gradient (darker back/bottom → lighter top-front) + soft rim; the belly/face patch is a second gradient.
  await k.paint(body, {
    look: { rim: 0.35, rimWidth: 0.05, rimLighten: 0.35, glow: 0.1, vignette: 0.06, faceGradient: 0.05, hardAngle: 60 },
    gradient: [
      { type: 'linear', from: 'bottom-back', to: 'top-front', stops: [[0, p.furShade], [0.4, p.fur], [0.85, p.fur], [1, p.furLight]] },
      { type: 'radial', center: 'bottom-front', axis: 'z', radius: 0.42, ease: 'smooth', stops: [[0, p.belly], [0.55, p.belly], [1, p.fur]], where: c => c.worldNormal.z > 0.5, amount: 0.95 },
    ],
  });
  // Eyes: white ring, big iris, pupil, two highlights (top-left big, bottom-right small).
  const eyeR = s * 0.16, eyeY = s * 0.73, eyeZ = s * 0.45 + 0.001;
  for (const [i, x] of [[0, -s * 0.2], [1, s * 0.2]]) {
    const eye = k.group(`Eye${i}`, { at: [x, eyeY, eyeZ] });
    k.mesh(`EyeWhite${i}`, 'cylinder', [eyeR, eyeR, s * 0.02, 32], k.material('#ffffff', { roughness: 0.3 }), { parent: eye, rotate: [Math.PI / 2, 0, 0] });
    k.mesh(`Iris${i}`, 'cylinder', [eyeR * 0.82, eyeR * 0.82, s * 0.024, 32], k.material(p.eye, { roughness: 0.15 }), { parent: eye, rotate: [Math.PI / 2, 0, 0], at: [0, -eyeR * 0.04, 0.002] });
    k.mesh(`Pupil${i}`, 'cylinder', [eyeR * 0.45, eyeR * 0.45, s * 0.026, 32], k.material('#11121a', { roughness: 0.1 }), { parent: eye, rotate: [Math.PI / 2, 0, 0], at: [0, -eyeR * 0.06, 0.004] });
    k.mesh(`Shine${i}`, 'sphere', [eyeR * 0.22, 12, 8], k.material('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.6 }), { parent: eye, at: [-eyeR * 0.3, eyeR * 0.28, s * 0.02], scale: [1, 1, 0.35] });
    k.mesh(`Shine${i}b`, 'sphere', [eyeR * 0.1, 10, 6], k.material('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.6 }), { parent: eye, at: [eyeR * 0.32, -eyeR * 0.3, s * 0.02], scale: [1, 1, 0.35] });
  }
  k.mesh('Nose', 'cone', [s * 0.035, s * 0.04, 3], k.material('#3a2328'), { at: [0, s * 0.56, eyeZ + 0.005], rotate: [Math.PI / 2, 0, Math.PI] });
  // Ears (species): cat = short cones, bunny = tall rounded boxes, bear = round discs.
  const earMat = k.material(p.fur), inner = k.material(p.innerEar);
  for (const [i, x] of [[0, -s * 0.3], [1, s * 0.3]]) {
    const top = s * 0.18 + s * 0.9;
    if (p.species === 'bunny') { k.mesh(`Ear${i}`, 'roundedBox', [s * 0.18, s * 0.5, s * 0.1, 3, s * 0.06], earMat, { at: [x * 0.8, top + s * 0.2, 0] }); k.mesh(`EarIn${i}`, 'roundedBox', [s * 0.1, s * 0.36, s * 0.02, 2, s * 0.03], inner, { at: [x * 0.8, top + s * 0.2, s * 0.05] }); }
    else if (p.species === 'bear') { k.mesh(`Ear${i}`, 'cylinder', [s * 0.12, s * 0.12, s * 0.1, 24], earMat, { at: [x, top + s * 0.02, 0], rotate: [Math.PI / 2, 0, 0] }); k.mesh(`EarIn${i}`, 'cylinder', [s * 0.07, s * 0.07, s * 0.02, 20], inner, { at: [x, top + s * 0.02, s * 0.05], rotate: [Math.PI / 2, 0, 0] }); }
    else { k.mesh(`Ear${i}`, 'cone', [s * 0.13, s * 0.24, 4], earMat, { at: [x, top + s * 0.1, 0], rotate: [0, Math.PI / 4, 0] }); k.mesh(`EarIn${i}`, 'cone', [s * 0.07, s * 0.15, 4], inner, { at: [x, top + s * 0.08, s * 0.05], rotate: [0, Math.PI / 4, 0] }); }
  }
  for (const [i, x, z] of [[0, -1, -1], [1, 1, -1], [2, -1, 1], [3, 1, 1]]) k.mesh(`Leg${i}`, 'roundedBox', [s * 0.24, s * 0.22, s * 0.24, 3, s * 0.06], k.material(p.furShade), { at: [x * s * 0.3, s * 0.11, z * s * 0.27] });
  k.mesh('Tail', 'sphere', [s * 0.14, 20, 14], k.material(p.belly, { roughness: 0.9 }), { at: [0, s * 0.45, -s * 0.5] });
  for (const n of ['Leg0', 'Leg1', 'Leg2', 'Leg3', 'Tail', 'Ear0', 'Ear1']) await k.paint(n, { look: { rim: 0.3, rimWidth: 0.04, rimLighten: 0.3, vignette: 0.05, ao: 0 } });
}
