import { parentPort, workerData } from 'node:worker_threads';
import RAPIER from '@dimforge/rapier3d-compat';
import { CFG, NI, NO } from '../../src/sim/index.js';
import { buildBody, readPose, readJointAngles, driveMotors, clampVel } from '../../src/sim/body.js';
import { think } from '../../src/sim/brain.js';
import { decodeGenome, encodeCreature } from './region-snapshot.mjs';

const MAXJ = CFG.MAXP - 1;
const { index, bounds, size, grid, H } = workerData;

await RAPIER.init();
const R = RAPIER;
const world = new R.World({ x: 0, y: -9.81, z: 0 });
world.timestep = CFG.DT;
world.createCollider(
  R.ColliderDesc.heightfield(grid, grid, new Float32Array(H), { x: size, y: 1, z: size }).setFriction(1.0),
);

let creatures = [];
let stepCount = 0;
let handoverMs = 0;

function restore(e) {
  const genome = decodeGenome(e.genome);
  const b0 = e.bodies[0];
  const body = buildBody(R, world, genome, b0.p.x, b0.p.z, () => 0, 0);
  for (let i = 0; i < body.bodies.length; i++) {
    const s = e.bodies[i];
    if (!s) break;
    const rb = body.bodies[i];
    rb.setTranslation(s.p, true);
    rb.setRotation(s.q, true);
    rb.setLinvel(s.v, true);
    rb.setAngvel(s.w, true);
  }
  const c = {
    id: e.id,
    genome,
    energy: e.energy,
    maxE: e.maxE,
    phase: e.phase,
    mem: Float32Array.from(e.mem),
    hidden: Float32Array.from(e.hidden),
    out: new Float32Array(NO),
    inp: new Float32Array(NI),
    angles: new Float32Array(MAXJ),
    sense: { ...(e.sense || {}) },
    ate: 0,
    hurt: 0,
    ...body,
  };
  readPose(c);
  creatures.push(c);
}

function stepOnce() {
  for (const c of creatures) {
    readJointAngles(c);
    think(c, CFG.DT);
    driveMotors(c);
  }
  world.step();
  stepCount++;
  if (stepCount % 2 === 0) for (const c of creatures) clampVel(c);
  for (const c of creatures) readPose(c);
}

function outside(p) {
  return p.x < bounds.x0 || p.x > bounds.x1 || p.z < bounds.z0 || p.z > bounds.z1;
}

function emitOutside() {
  const out = [];
  const keep = [];
  for (const c of creatures) {
    if (outside(c.pos[0])) {
      out.push(encodeCreature(c));
      for (const b of c.bodies) world.removeRigidBody(b);
    } else {
      keep.push(c);
    }
  }
  creatures = keep;
  return out;
}

const round4 = (v) => Math.round(v * 1e4) / 1e4;

parentPort.on('message', (msg) => {
  if (!msg) return;
  if (msg.type === 'step') {
    const t0 = performance.now();
    const immigrants = [...(msg.immigrants || [])].sort((a, b) => a.id - b.id);
    for (const e of immigrants) restore(e);
    handoverMs += performance.now() - t0;

    const t1 = performance.now();
    stepOnce();
    const computeMs = performance.now() - t1;

    const emigrants = emitOutside();
    parentPort.postMessage({ type: 'done', emigrants, computeMs, handoverMs, count: creatures.length });
  } else if (msg.type === 'hash') {
    const entries = creatures.map((c) => {
      const p = c.pos[0];
      return [c.id, round4(p.x), round4(p.y), round4(p.z)];
    });
    parentPort.postMessage({ type: 'hash', entries });
  }
});

parentPort.postMessage({ type: 'ready', index });
