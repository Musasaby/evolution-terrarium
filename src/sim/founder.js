// ===== 祖先の用意：平地での試走による短い事前進化 =====
// 本番の世界とは別の小さな物理世界をつくって試走させる。sim からは R・rng・個体の雛形づくりだけを使う。
import { CFG } from './config.js';
import { qRot } from './math.js';
import { randomGenome, cloneGenome, mutate, genomeStats } from './genetics.js';
import { buildBody, readPose, readJointAngles, driveMotors, clampVel, travelDir } from './body.js';
import { think } from './brain.js';
import { makeCreatureState } from './creatures.js';

function trialWorld(R, half) {
  const w = new R.World({ x: 0, y: -9.81, z: 0 }); w.timestep = CFG.DT;
  w.createCollider(R.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, -0.5, 0).setFriction(1.0));
  return w;
}
// 試走用の個体（ID は消費しない）
// yaw は関数で受け取る（乱数を引く順番を「個体の雛形 → 向き」に保つため）
function trialCreature(sim, w, genome, yaw) {
  const c = makeCreatureState(sim, genome, {});
  sim.nextCreatureId--;
  Object.assign(c, buildBody(sim.R, w, genome, 0, 0, () => 0, yaw()));
  return c;
}
function tick(c, w) {
  readPose(c);
  readJointAngles(c);
  think(c, CFG.DT);
  driveMotors(c);
  w.step();
  clampVel(c);
}

// 平地での試走距離
export function trialDistance(sim, genome, secs = 8) {
  const rng = sim.rng;
  const w = trialWorld(sim.R, 50);
  const c = trialCreature(sim, w, genome, () => 0);
  const rs = () => rng.range(-1, 1);
  c.sense = { ps: rs(), pc: rs(), pp: rng(), cs: rs(), cc: rs(), cp: rng() * 0.5, kin: rs(), size: rs() * 0.5, waterAhead: 0, slope: 0, temp: rs() * 0.5, up: 0 };
  c.energy = c.maxE * 0.5;
  const n = secs / CFG.DT;
  let p0 = null;
  for (let i = 0; i < n; i++) {
    tick(c, w);
    if (i === 40) p0 = c.bodies[0].translation();
  }
  const p1 = c.bodies[0].translation();
  const d = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const bad = !isFinite(d) || p1.y > 5;
  w.free();
  return bad ? 0 : d;
}

// 平地での試走：感覚で示した目標方向へどれだけ近づけるか
export function trialSteer(sim, genome, phases = 4, secs = 3.5) {
  const rng = sim.rng;
  const w = trialWorld(sim.R, 80);
  const c = trialCreature(sim, w, genome, () => rng() * 6.28);
  c.energy = c.maxE * 0.6;
  const s = c.sense = { ps: 0, pc: 0, pp: 0, cs: 0, cc: 0, cp: 0, kin: 1, size: 0, waterAhead: 0, slope: 0, temp: 0, up: 0 };
  let score = 0;
  const settle = 30;
  for (let i = 0; i < settle; i++) tick(c, w);
  for (let ph = 0; ph < phases; ph++) {
    const p0 = c.bodies[0].translation();
    const a = rng() * Math.PI * 2;
    const tx = p0.x + Math.cos(a) * 12, tz = p0.z + Math.sin(a) * 12;
    for (let i = 0; i < secs / CFG.DT; i++) {
      if (i % 4 === 0) {
        const pos = c.bodies[0].translation(), q = c.bodies[0].rotation();
        const hd = travelDir(c, q), fx = hd.x, fz = hd.z;
        const dx = tx - pos.x, dz = tz - pos.z, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
        // 目標を「食べ物」として感じさせる
        s.ps = fx * uz - fz * ux; s.pc = fx * ux + fz * uz; s.pp = Math.max(0.05, 1 - l / CFG.SENSE_R);
        s.cs = 0; s.cc = 0; s.cp = 0;
        s.up = qRot(q, { x: 0, y: 0, z: 1 }).y;
      }
      tick(c, w);
    }
    const p1 = c.bodies[0].translation();
    const d0 = Math.hypot(tx - p0.x, tz - p0.z), d1 = Math.hypot(tx - p1.x, tz - p1.z);
    if (!isFinite(d1)) { score = -99; break; }
    score += d0 - d1;
  }
  w.free();
  return score;
}

// 祖先は「平地をどれだけ進めるか」で短い事前進化をさせて用意する
export function evolvedFounder(sim, pop = 10, gens = 4) {
  const rng = sim.rng;
  // 体の大きさあたりの前進距離で評価する
  const score = (g) => trialDistance(sim, g, 6) / (0.6 + Math.sqrt(genomeStats(g).vol));
  let cands = [];
  for (let i = 0; i < pop; i++) { const g = randomGenome(rng); cands.push({ g, f: score(g) }); }
  for (let gen = 1; gen < gens; gen++) {
    cands.sort((x, y) => y.f - x.f);
    const elite = cands.slice(0, 3);
    cands = elite.slice();
    while (cands.length < pop) {
      const p = rng.pick(elite), g = cloneGenome(p.g);
      g.marks = p.g.marks.slice();
      mutate(g, rng, 2);
      cands.push({ g, f: score(g) });
    }
  }
  cands.sort((x, y) => y.f - x.f);
  // 走性の向き（右に曲がるか左に曲がるか）は体のつくり次第なので、試して合う向きを選ぶ
  const g = cands[0].g;
  let bestT = 0, bestS = -Infinity;
  for (const tx of [-2, 0, 2]) { g.taxis = tx; const sc = trialSteer(sim, g, 4, 4) + trialSteer(sim, g, 4, 4); if (sc > bestS) { bestS = sc; bestT = tx; } }
  g.taxis = bestT + rng.gauss() * 0.3;
  return g;
}
