import RAPIER from '@dimforge/rapier3d-compat';
import { Sim } from '../../src/sim/index.js';

const xyz = (v) => ({ x: v.x, y: v.y, z: v.z });
const xyzw = (v) => ({ x: v.x, y: v.y, z: v.z, w: v.w });

export function encodeCreature(c) {
  const g = c.genome;
  const sense = { ...(c.sense || {}) };
  delete sense.plant;
  delete sense.other;
  return {
    id: c.id,
    genome: { ...g, brain: Array.from(g.brain), marks: Array.from(g.marks) },
    energy: c.energy,
    maxE: c.maxE,
    phase: c.phase,
    mem: Array.from(c.mem),
    hidden: Array.from(c.hidden),
    sense,
    bodies: c.bodies.map((b) => ({
      p: xyz(b.translation()),
      q: xyzw(b.rotation()),
      v: xyz(b.linvel()),
      w: xyz(b.angvel()),
    })),
  };
}

export function decodeGenome(g) {
  return { ...g, brain: Float32Array.from(g.brain), marks: Int32Array.from(g.marks) };
}

export async function takeSnapshot({ seed, size, warm }) {
  await RAPIER.init();
  const sim = new Sim(RAPIER, seed, { settings: { size } });
  for (let i = 0; i < warm; i++) sim.step();
  const creatures = [];
  for (const c of sim.creatures) if (c.alive && !c.dead) creatures.push(encodeCreature(c));
  return { size: sim.size, grid: sim.grid, H: Array.from(sim.H), creatures };
}
