// 物理の詳細度の切り替え（LOD）の実現性を測る（V0）
//   node tools/scaling/lod-check.mjs [--seed 1] [--warm 9000] [--window 600] [--sample 60] [--out <path>]
//
// 1. warm ステップ進めて生きている個体の根の位置を控え、さらに window ステップ進める。
//    その間ずっと生きていた個体の水平移動距離を window × CFG.DT で割り「本来の物理での速さ」にする。
// 2. その個体を id 順に並べた先頭 sample 体について、試走の速さ（trialDistance / (6 − 40 × CFG.DT)）を求める。
//    両者のピアソン相関係数とスピアマンの順位相関係数を出す。
// 3. 同じ個体を物理世界から外す／付け直すのにかかった時間を測り、中央値を出す。
// 4. 付け直した後に 30 ステップ進め、体節が地面より沈む割合（sinkRate）と根が 6 m/s を超える割合（spikeRate）を出す。
import RAPIER from '@dimforge/rapier3d-compat';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Sim, CFG } from '../../src/sim/index.js';
import { trialDistance } from '../../src/sim/founder.js';
import { buildBody, readPose, heading } from '../../src/sim/body.js';

const STEP_AFTER_ATTACH = 30;
const SPIKE_SPEED = 6;

function parseArgs(argv) {
  const out = { seed: 1, warm: 9000, window: 600, sample: 60, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') out.seed = +argv[++i];
    else if (a === '--warm') out.warm = +argv[++i];
    else if (a === '--window') out.window = +argv[++i];
    else if (a === '--sample') out.sample = +argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  return out;
}

function median(xs) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const den = Math.sqrt(sxx * syy);
  return den === 0 ? 0 : sxy / den;
}

// 順位（同順位は平均順位、1 始まり）
function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function spearman(xs, ys) {
  return pearson(ranks(xs), ranks(ys));
}

const opts = parseArgs(process.argv.slice(2));
await RAPIER.init();

const sim = new Sim(RAPIER, opts.seed);

for (let i = 0; i < opts.warm; i++) sim.step();

// 生きている個体の根の位置を控える
const start = new Map();
for (const c of sim.creatures) {
  if (c.alive && !c.dead && c.pos && c.pos[0]) start.set(c, { x: c.pos[0].x, z: c.pos[0].z });
}

for (let i = 0; i < opts.window; i++) sim.step();

// その間ずっと生きていた個体の、本来の物理での速さ
const survived = [];
for (const [c, p0] of start) {
  if (!(c.alive && !c.dead) || !c.pos || !c.pos[0]) continue;
  const p1 = c.pos[0];
  const dist = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  survived.push({ c, actual: dist / (opts.window * CFG.DT) });
}
survived.sort((a, b) => a.c.id - b.c.id);
const chosen = survived.slice(0, opts.sample);
const n = chosen.length;

// 試走の速さ（i = 40 から測るため、その分を引く）
for (const s of chosen) {
  const d = trialDistance(sim, s.c.genome, 6);
  s.trial = d / (6 - 40 * CFG.DT);
}

// 外す／付け直すの所要時間
const detachTimes = [], attachTimes = [];
for (const s of chosen) {
  const c = s.c;
  const root = c.pos[0];
  const x = root.x, z = root.z;
  s.x = x; s.z = z;
  const h = heading(c.rot[0]);
  const yaw = Math.atan2(h.z, h.x);

  const t0 = process.hrtime.bigint();
  for (const col of c.cols) sim.colliderOwner.delete(col.handle);
  for (const b of c.bodies) sim.world.removeRigidBody(b);
  const t1 = process.hrtime.bigint();

  const body = buildBody(sim.R, sim.world, c.genome, x, z, (a, b) => sim.heightAt(a, b), yaw);
  Object.assign(c, body);
  body.cols.forEach((col, i) => sim.colliderOwner.set(col.handle, { kind: 'c', obj: c, part: i }));
  readPose(c);
  const t2 = process.hrtime.bigint();

  detachTimes.push(Number(t1 - t0) / 1e6);
  attachTimes.push(Number(t2 - t1) / 1e6);
}

// 付け直した後に 30 ステップ進め、沈み・速度スパイクの割合を出す
const sink = new Set(), spike = new Set();
for (let step = 0; step < STEP_AFTER_ATTACH; step++) {
  sim.step();
  for (const s of chosen) {
    const c = s.c;
    if (!c.alive || c.dead) continue;
    const floor = sim.heightAt(s.x, s.z) - 0.2;
    if (c.pos) for (const P of c.pos) if (P.y < floor) { sink.add(s); break; }
    if (c.bodies[0]) {
      const v = c.bodies[0].linvel();
      if (Math.hypot(v.x, v.y, v.z) > SPIKE_SPEED) spike.add(s);
    }
  }
}
const sinkRate = n ? sink.size / n : 0;
const spikeRate = n ? spike.size / n : 0;

const trials = chosen.map((s) => s.trial);
const actuals = chosen.map((s) => s.actual);

const result = {
  date: new Date().toISOString(),
  seed: opts.seed,
  warm: opts.warm,
  window: opts.window,
  n,
  pearson: pearson(trials, actuals),
  spearman: spearman(trials, actuals),
  pairs: chosen.map((s) => [s.trial, s.actual]),
  detachMs: median(detachTimes),
  attachMs: median(attachTimes),
  sinkRate,
  spikeRate,
};

console.log(JSON.stringify(result, null, 2));
if (opts.out) {
  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify(result, null, 2) + '\n');
}
