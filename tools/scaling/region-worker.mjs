import { parentPort, workerData } from 'node:worker_threads';
import RAPIER from '@dimforge/rapier3d-compat';
import { CFG, NI, NO } from '../../src/sim/index.js';
import { buildBody, readPose, readJointAngles, driveMotors, clampVel } from '../../src/sim/body.js';
import { think } from '../../src/sim/brain.js';
import { decodeGenome, encodeCreature } from './region-snapshot.mjs';

const MAXJ = CFG.MAXP - 1;
const { index, bounds, size, grid, H, atomics } = workerData;

function boxOverflowError(capacity, attempted) {
  const err = new Error(`共有箱があふれました: 箱の大きさ ${capacity} バイトを超える ${attempted} バイトを書こうとしました`);
  err.capacity = capacity;
  err.attempted = attempted;
  return err;
}

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

function processStep(immigrants) {
  const t0 = performance.now();
  const sorted = [...(immigrants || [])].sort((a, b) => a.id - b.id);
  for (const e of sorted) restore(e);
  handoverMs += performance.now() - t0;

  const t1 = performance.now();
  stepOnce();
  const computeMs = performance.now() - t1;

  const emigrants = emitOutside();
  return { emigrants, computeMs, handoverMs, count: creatures.length };
}

function hashEntries() {
  return creatures.map((c) => {
    const p = c.pos[0];
    return [c.id, round4(p.x), round4(p.y), round4(p.z)];
  });
}

parentPort.on('message', (msg) => {
  if (!msg) return;
  if (msg.type === 'step') {
    parentPort.postMessage({ type: 'done', ...processStep(msg.immigrants) });
  } else if (msg.type === 'hash') {
    parentPort.postMessage({ type: 'hash', entries: hashEntries() });
  }
});

parentPort.postMessage({ type: 'ready', index });

if (atomics) {
  const { ctrl, inbox, outbox } = atomics;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const headerOf = (sab) => new Int32Array(sab, 0, 1);

  const readBox = (sab) => {
    const len = Atomics.load(headerOf(sab), 0);
    const bytes = new Uint8Array(sab, 4, len).slice();
    return JSON.parse(decoder.decode(bytes));
  };
  const writeBox = (sab, value) => {
    const bytes = encoder.encode(JSON.stringify(value));
    const capacity = sab.byteLength - 4;
    if (bytes.length > capacity) throw boxOverflowError(capacity, bytes.length);
    new Uint8Array(sab, 4, bytes.length).set(bytes);
    Atomics.store(headerOf(sab), 0, bytes.length);
  };
  const CTRL_ERROR = 2;
  const CTRL_ERROR_CAPACITY = 3;
  const CTRL_ERROR_ATTEMPTED = 4;
  const CTRL_ERROR_INDEX = 5;

  let generation = 0;
  for (;;) {
    let current;
    while ((current = Atomics.load(ctrl, 0)) === generation) {
      Atomics.wait(ctrl, 0, generation);
    }
    if (current < 0) break;
    generation = current;
    try {
      const immigrants = readBox(inbox);
      const result = processStep(immigrants);
      writeBox(outbox, result);
    } catch (err) {
      if (Atomics.compareExchange(ctrl, CTRL_ERROR, 0, 1) === 0) {
        Atomics.store(ctrl, CTRL_ERROR_INDEX, index);
        Atomics.store(ctrl, CTRL_ERROR_CAPACITY, Number.isFinite(err && err.capacity) ? err.capacity : -1);
        Atomics.store(ctrl, CTRL_ERROR_ATTEMPTED, Number.isFinite(err && err.attempted) ? err.attempted : -1);
      }
    }
    Atomics.add(ctrl, 1, 1);
    Atomics.notify(ctrl, 1);
  }
}
