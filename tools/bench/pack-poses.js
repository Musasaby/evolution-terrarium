// ===== 体節の姿勢を 1 本の Float32Array に詰める（three に依存しない） =====
// 1 体節あたり STRIDE 個: [x, y, z, qx, qy, qz, qw, 半径, 色相]
export const STRIDE = 9;

export function packPoses(sim) {
  let n = 0;
  for (const c of sim.creatures) if (c.alive) n += c.bodies.length;

  const buf = new Float32Array(n * STRIDE);
  let k = 0;
  for (const c of sim.creatures) {
    if (!c.alive) continue;
    const parts = c.genome.parts;
    const hue = c.species?.hue ?? 0;
    for (let i = 0; i < c.bodies.length; i++) {
      const p = c.pos[i], r = c.rot[i], part = parts[i];
      buf[k++] = p.x; buf[k++] = p.y; buf[k++] = p.z;
      buf[k++] = r.x; buf[k++] = r.y; buf[k++] = r.z; buf[k++] = r.w;
      buf[k++] = part ? part.r : 0;
      buf[k++] = hue;
    }
  }
  return { buf, n };
}
