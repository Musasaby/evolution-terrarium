// 島モデルの試作：1 つの島（独立した世界）を worker_threads で動かす
// workerData: { index, seed, size, jitter }
// メッセージ:
//   { type: 'run', steps }              → { computeMs }
//   { type: 'stats' }                   → { living, speciesCounts, dietCounts, div, speciesInfo }
//   { type: 'emigrate', k, rngSeed }    → { migrants }
//   { type: 'immigrate', migrants, rngSeed } → { placed, dropped }
//   { type: 'hash' }                    → { hash }
import { parentPort, workerData } from 'node:worker_threads';
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim, makeRng, cloneGenome, computeDiversity } from '../../src/sim/index.js';
import { spawnCreature, newSpecies, removeCreature } from '../../src/sim/creatures.js';
import { stateHash } from '../state-hash.mjs';

// diversity.js / diversity-worker.mjs と同じ分類：<0.25=草, <0.75=葉, 以上=肉
const DIET_EDGE = [0.25, 0.75];
const isLiving = (c) => c.alive && !c.dead;

const { index, seed, size, jitter = false } = workerData;
const SAMPLE = 3;
const originKey = new Map(); // 種 id -> 由来キー(移住で生まれた種だけ)

// 島をまたいで同じ系統かを見分けるキー。移住で生まれた種は出身の種のキーを受け継ぐ
function speciesKey(sp) {
  return originKey.get(sp.id) ?? `${index}:${sp.id}`;
}

await RAPIER.init();
const sim = new Sim(RAPIER, seed, { settings: { size } });

function runSteps(steps) {
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) sim.step();
  return { computeMs: performance.now() - t0 };
}

function stats() {
  const live = sim.creatures.filter(isLiving);
  const bySp = new Map();
  const dietCounts = [0, 0, 0];
  for (const c of live) {
    bySp.set(c.species, (bySp.get(c.species) || 0) + 1);
    const d = c.genome.diet ?? 0.25;
    dietCounts[d < DIET_EDGE[0] ? 0 : d < DIET_EDGE[1] ? 1 : 2]++;
  }
  const speciesCounts = [];
  for (const [sp, n] of bySp) speciesCounts.push([sp.id, n]);
  const div = computeDiversity(sim);
  const speciesInfo = [];
  for (const [sp, n] of bySp) {
    const members = live.filter((c) => c.species === sp).sort((a, b) => a.id - b.id).slice(0, SAMPLE);
    speciesInfo.push({ id: sp.id, n, key: speciesKey(sp), genomes: members.map((c) => cloneGenome(c.genome)) });
  }
  return {
    living: live.length,
    speciesCounts,
    dietCounts,
    div: { effSpecies: div.effSpecies, effDiet: div.effDiet },
    speciesInfo,
  };
}

function emigrate(k, rngSeed) {
  const rng = makeRng(rngSeed);
  const live = sim.creatures.filter(isLiving).sort((a, b) => a.id - b.id);
  const n = live.length;
  const order = Array.from({ length: n }, (_, i) => i);
  const chosen = [];
  const take = Math.min(k, n);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (n - i));
    [order[i], order[j]] = [order[j], order[i]];
    chosen.push(live[order[i]]);
  }
  const migrants = chosen.map((c) => ({
    genome: cloneGenome(c.genome),
    energyFrac: c.maxE > 0 ? c.energy / c.maxE : 0,
    origin: speciesKey(c.species),
  }));
  for (const c of chosen) {
    if (c.species) c.species.count--;
    removeCreature(sim, c);
  }
  return { migrants };
}

function immigrate(migrants, rngSeed) {
  const rng = makeRng(rngSeed);
  const edge = sim.edge;
  const lim = edge - 10;
  let placed = 0, dropped = 0;
  for (const m of migrants) {
    let x = null, z = null;
    for (let t = 0; t < 20; t++) {
      const xx = rng.range(-lim, lim), zz = rng.range(-lim, lim);
      if (!sim.isWater(xx, zz)) { x = xx; z = zz; break; }
    }
    if (x === null) { dropped++; continue; }
    let best = null, bestCount = -1;
    for (const sp of sim.species.values()) {
      if (sp.count <= 0) continue;
      if (sim.interfertile(sp.rep, m.genome) && sp.count > bestCount) {
        best = sp;
        bestCount = sp.count;
      }
    }
    if (!best) { best = newSpecies(sim, m.genome, null, true); originKey.set(best.id, m.origin); }
    spawnCreature(sim, m.genome, x, z, { species: best, energyFrac: m.energyFrac, gen: 0 });
    placed++;
  }
  return { placed, dropped };
}

parentPort.on('message', async (msg) => {
  if (!msg) return;
  if (jitter) await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20)));
  const { id, type } = msg;
  let result;
  if (type === 'run') result = runSteps(msg.steps);
  else if (type === 'stats') result = stats();
  else if (type === 'emigrate') result = emigrate(msg.k, msg.rngSeed);
  else if (type === 'immigrate') result = immigrate(msg.migrants, msg.rngSeed);
  else if (type === 'hash') result = { hash: stateHash(sim) };
  else return;
  parentPort.postMessage({ id, ...result });
});

parentPort.postMessage({ type: 'ready', index });
