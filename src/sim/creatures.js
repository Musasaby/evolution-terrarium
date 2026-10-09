// ===== 生物：誕生・感覚・代謝・死 =====
// すべて「sim を第1引数に受け取る関数」として書き、何に依存しているかを引数から読めるようにしている。
// sim に求めるもの: R, world, rng, t, stepCount, creatures, species, colliderOwner, counters, flora,
//                    heightAt / isWater / tempAt / log
import { CFG, SCHEDULE, EDGE, MAXJ, NMEM, NI, NH, NO } from './config.js';
import { clamp, qRot } from './math.js';
import { cloneGenome, mutate, newAllele, genomeStats, compatibility, NMARK } from './genetics.js';
import { buildBody, readJointAngles, driveMotors, travelDir } from './body.js';
import { think } from './brain.js';
import { speciesName } from './naming.js';
import { PLANT_CELL } from './flora.js';
import { evolvedFounder } from './founder.js';

// 生物の空間グリッド（8m 四方）のキー
const CREATURE_CELL = 8;
const creatureKey = (gx, gz) => (gx << 8) | gz;

export function makeCreatureState(sim, genome, opts) {
  const st = genomeStats(genome);
  return {
    id: sim.nextCreatureId++, genome, species: opts.species, gen: opts.gen || 0,
    parents: opts.parents || null, born: sim.t, age: 0, alive: true, dead: false, deadAt: 0,
    vol: st.vol, area: st.area, nParts: genome.parts.length,
    maxE: 500 * st.vol + 60, energy: 0, children: 0, kills: 0, eaten: 0,
    bodies: [], cols: [], joints: [], phase: sim.rng() * 6.28, mem: new Float32Array(NMEM),
    hidden: new Float32Array(NH), out: new Float32Array(NO), inp: new Float32Array(NI),
    angles: new Float32Array(MAXJ),
    lastMate: sim.t, hurt: 0, ate: 0, sense: null, mutations: opts.mutations || [],
    cost: { base: 0, move: 0, climate: 0, water: 0 },
  };
}

export function spawnCreature(sim, genome, x, z, opts = {}) {
  const c = makeCreatureState(sim, genome, opts);
  c.energy = c.maxE * (opts.energyFrac ?? 0.6);
  if (opts.energy !== undefined) c.energy = Math.min(c.maxE, opts.energy);
  const yaw = opts.yaw ?? sim.rng() * Math.PI * 2;
  const body = buildBody(sim.R, sim.world, genome, x, z, (a, b) => sim.heightAt(a, b), yaw, opts.lift || 0);
  Object.assign(c, body);
  body.cols.forEach((col, i) => sim.colliderOwner.set(col.handle, { kind: 'c', obj: c, part: i }));
  if (c.species) { c.species.count++; c.species.total++; c.species.peak = Math.max(c.species.peak, c.species.count); }
  sim.creatures.push(c);
  return c;
}

export function newSpecies(sim, genome, parentSp, quiet = false) {
  const id = sim.nextSpeciesId++;
  const sp = { id, parent: parentSp ? parentSp.id : null, rep: cloneGenome(genome), born: sim.t, extinct: null, count: 0, peak: 0, total: 0, hue: genome.hue, name: speciesName(sim.rng), depth: parentSp ? parentSp.depth + 1 : 0 };
  sim.species.set(id, sp);
  if (parentSp && !quiet) sim.log(`新種「${sp.name}」が「${parentSp.name}」から分岐した`, 'species');
  return sp;
}

// 共通祖先をもつ小集団を出現させる（出会いと交配の機会を確保）
export function spawnFounderGroup(sim, n) {
  const g = evolvedFounder(sim);
  const sp = newSpecies(sim, g, null);
  const rng = sim.rng;
  for (let tries = 0; tries < 40; tries++) {
    const x = rng.range(-EDGE + 10, EDGE - 10), z = rng.range(-EDGE + 10, EDGE - 10);
    if (sim.isWater(x, z) || sim.heightAt(x, z) > 12) continue;
    let first = null;
    for (let k = 0; k < n; k++) {
      // 創始集団にも少しの遺伝的多様性がある
      const gk = cloneGenome(g);
      if (k) { mutate(gk, rng, 0.5); for (let m = 0; m < 3; m++) gk.marks[rng.int(0, NMARK - 1)] = newAllele(); }
      const a = rng() * Math.PI * 2, d = rng.range(1, 5);
      const xx = x + Math.cos(a) * d, zz = z + Math.sin(a) * d;
      if (sim.isWater(xx, zz)) continue;
      const c = spawnCreature(sim, gk, xx, zz, { species: sp, gen: 0, energyFrac: 0.75 });
      first = first || c;
    }
    return first;
  }
  return null;
}

export function kill(sim, c, cause) {
  if (c.dead) return;
  c.dead = true; c.deadAt = sim.t; c.cause = cause;
  c.corpseE = Math.max(c.energy, 0) + c.maxE * 0.35;
  c.energy = 0;
  for (const j of c.joints) j.configureMotorPosition(0, 0, 0.5);
  for (const b of c.bodies) b.setAngularDamping(2);
  sim.counters.deaths++;
  const sp = c.species;
  if (sp) {
    sp.count--;
    if (sp.count <= 0 && !sim.creatures.some(o => o.alive && !o.dead && o.species === sp)) {
      sp.extinct = sim.t;
      sim.log(`種「${sp.name}」が絶滅した`, 'extinct');
    }
  }
}

export function removeCreature(sim, c) {
  c.alive = false;
  for (const col of c.cols) sim.colliderOwner.delete(col.handle);
  for (const b of c.bodies) sim.world.removeRigidBody(b);
  c.bodies = []; c.cols = []; c.joints = [];
}

export const center = (c) => c.bodies[0].translation();
export const isLiving = (c) => c.alive && !c.dead;

export function livingCount(sim) { let n = 0; for (const c of sim.creatures) if (isLiving(c)) n++; return n; }

// 生物の位置の空間グリッド（1ステップに1回だけ作る）
export function creatureGrid(sim) {
  if (sim._cgStep === sim.stepCount) return sim._cg;
  const G = new Map();
  for (const o of sim.creatures) {
    if (!o.alive || !o.bodies[0]) continue;
    const t = o.bodies[0].translation();
    const k = creatureKey(Math.floor((t.x + 100) / CREATURE_CELL), Math.floor((t.z + 100) / CREATURE_CELL));
    (G.get(k) || G.set(k, []).get(k)).push({ c: o, x: t.x, z: t.z });
  }
  sim._cg = G; sim._cgStep = sim.stepCount;
  return G;
}

// 感覚：最寄りの食べ物・最寄りの生物・前方の地形・気温・姿勢
export function sense(sim, c) {
  const pos = center(c), R = CFG.SENSE_R;
  const q = c.bodies[0].rotation();
  const f = travelDir(c, q);
  // 最寄りの植物
  let bp = null, bd = R * R;
  const k0 = Math.floor((pos.x + 100) / PLANT_CELL), k1 = Math.floor((pos.z + 100) / PLANT_CELL), rr = Math.ceil(R / PLANT_CELL);
  const pgrid = sim.flora.grid;
  for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) {
    const arr = pgrid.get(((k0 + a) << 8) | (k1 + b)); if (!arr) continue;
    for (const p of arr) {
      // 食べられる状態の植物だけを感じ取る（食べ尽くされて回復待ちの草は無視）
      if (p.sp.soft ? (p.dormant > sim.t || p.energy < p.maxE * (CFG.GRAZE_FLOOR + 0.15)) : p.energy < 1) continue;
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2; if (d < bd) { bd = d; bp = p; }
    }
  }
  // 最寄りの生物（死骸含む）
  let bc = null, cd = R * R, bcx = 0, bcz = 0;
  const G = creatureGrid(sim), gx = Math.floor((pos.x + 100) / CREATURE_CELL), gz = Math.floor((pos.z + 100) / CREATURE_CELL), gr = Math.ceil(R / CREATURE_CELL);
  for (let a = -gr; a <= gr; a++) for (let b = -gr; b <= gr; b++) {
    const arr = G.get(creatureKey(gx + a, gz + b)); if (!arr) continue;
    for (const o of arr) {
      if (o.c === c || !o.c.alive) continue;
      const d = (o.x - pos.x) ** 2 + (o.z - pos.z) ** 2;
      if (d < cd) { cd = d; bc = o.c; bcx = o.x; bcz = o.z; }
    }
  }
  const rel = (tx, tz) => { const dx = tx - pos.x, dz = tz - pos.z, l = Math.hypot(dx, dz) || 1; const ux = dx / l, uz = dz / l; return [f.x * uz - f.z * ux, f.x * ux + f.z * uz]; };
  const s = c.sense || (c.sense = {});
  s.plant = bp; s.other = bc;
  if (bp) { [s.ps, s.pc] = rel(bp.x, bp.z); s.pp = 1 - Math.sqrt(bd) / R; } else { s.ps = 0; s.pc = 0; s.pp = 0; }
  if (bc) {
    [s.cs, s.cc] = rel(bcx, bcz); s.cp = 1 - Math.sqrt(cd) / R;
    s.kin = bc.dead ? -1 : compatibility(c.genome, bc.genome) * 2 - 1;
    s.size = clamp(Math.log((bc.vol + 0.01) / (c.vol + 0.01)), -2, 2) / 2;
  } else { s.cs = s.cc = s.cp = s.kin = s.size = 0; }
  const ax = pos.x + f.x * 2.5, az = pos.z + f.z * 2.5;
  s.waterAhead = sim.isWater(ax, az) ? 1 : 0;
  s.slope = clamp((sim.heightAt(ax, az) - sim.heightAt(pos.x, pos.z)) / 2.5, -1, 1);
  s.temp = clamp((sim.tempAt(pos.x, pos.z) - 15) / 15, -1.5, 1.5);
  s.up = qRot(q, { x: 0, y: 0, z: 1 }).y;
}

// 死骸の分解（倒れて動かなくなったら固定物にして物理計算を省く）
function decayCorpse(sim, c, dt) {
  c.corpseE -= (0.4 + c.corpseE * 0.012) * dt;
  if (c.corpseE <= 0 || sim.t - c.deadAt > 40) { removeCreature(sim, c); return; }
  if (!c.frozen && sim.t - c.deadAt > 3) { c.frozen = true; for (const b of c.bodies) b.setBodyType(sim.R.RigidBodyType.Fixed, false); }
}

// 物理ステップ前の、各個体の制御とエネルギー収支
export function updateCreatures(sim, dt) {
  const sc = sim.stepCount, wl = sim.climate.water, T = sim.climate.temp, baseWater = sim.climate.baseWater;
  for (let ci = 0; ci < sim.creatures.length; ci++) {
    const c = sim.creatures[ci];
    if (!c.alive) continue;
    if (c.dead) { decayCorpse(sim, c, dt); continue; }
    c.age += dt;
    if (c.hurt > 0) c.hurt -= dt;
    if (c.ate > 0) c.ate -= dt;
    readJointAngles(c);
    if (!c.sense || (sc + c.id) % SCHEDULE.SENSE === 0) sense(sim, c);
    think(c, dt);
    const move = driveMotors(c);
    // エネルギー消費
    const base = 0.1 + 0.65 * c.vol + 0.055 * c.nParts + 0.03 * c.joints.length;
    const mv = move * 0.0006;
    let clim = 0;
    const pos = c.bodies[0].translation();
    const lt = T - 0.55 * Math.max(0, sim.heightAt(pos.x, pos.z) - baseWater);
    if (lt < 5) clim = (5 - lt) * 0.03 * c.area;
    else if (lt > 29) clim = (lt - 29) * 0.12 * c.vol;
    let wet = 0, sub = 0;
    for (const b of c.bodies) if (b.translation().y < wl) sub++;
    if (sub) {
      wet = (2.0 + 8 * c.vol) * sub / c.bodies.length;
      for (const b of c.bodies) b.setLinearDamping(b.translation().y < wl ? 2.5 : 0.1);
    } else if (c.wasWet) for (const b of c.bodies) b.setLinearDamping(0.1);
    c.wasWet = sub > 0;
    c.cost.base = base; c.cost.move = mv; c.cost.climate = clim; c.cost.water = wet;
    c.energy -= (base + mv + clim + wet) * dt;
    if (c.energy <= 0) { kill(sim, c, '飢餓'); continue; }
    if (pos.y < -20) { kill(sim, c, '転落'); continue; }
    if (c.age > 600 + c.vol * 400) { kill(sim, c, '寿命'); continue; }
  }
}

// 消えた個体を配列から除き、少なくなりすぎたら新しい群れを移入させる
export function housekeeping(sim) {
  sim.creatures = sim.creatures.filter(c => c.alive);
  const n = livingCount(sim);
  if (n < CFG.MIN_POP && sim.autoImmigrate !== false && sim.t - (sim.lastImmig || -99) > 20) {
    sim.lastImmig = sim.t;
    const c = spawnFounderGroup(sim, CFG.GROUP);
    if (c) sim.log(`個体数が減り、未知の新種「${c.species.name}」の群れが移入した`, 'info');
  }
}
