// 島モデルの試作：1 つの島（独立した世界）を worker_threads で動かす
// workerData: { index, seed, size }
// メッセージ:
//   { type: 'run', steps }              → { computeMs }
//   { type: 'stats' }                   → { living, speciesCounts, dietCounts, div }
//   { type: 'emigrate', k, rngSeed }    → { migrants }
//   { type: 'immigrate', migrants, rngSeed } → { placed, dropped }
import { parentPort, workerData } from 'node:worker_threads';
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim, makeRng, cloneGenome, computeDiversity } from '../../src/sim/index.js';
import { spawnCreature, newSpecies, removeCreature } from '../../src/sim/creatures.js';

// diversity.js / diversity-worker.mjs と同じ分類：<0.25=草, <0.75=葉, 以上=肉
const DIET_EDGE = [0.25, 0.75];
const isLiving = (c) => c.alive && !c.dead;

const { index, seed, size } = workerData;

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
  return {
    living: live.length,
    speciesCounts,
    dietCounts,
    div: { effSpecies: div.effSpecies, effDiet: div.effDiet },
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
    if (!best) best = newSpecies(sim, m.genome, null, true);
    spawnCreature(sim, m.genome, x, z, { species: best, energyFrac: m.energyFrac, gen: 0 });
    placed++;
  }
  return { placed, dropped };
}

parentPort.on('message', (msg) => {
  if (!msg) return;
  const { id, type } = msg;
  let result;
  if (type === 'run') result = runSteps(msg.steps);
  else if (type === 'stats') result = stats();
  else if (type === 'emigrate') result = emigrate(msg.k, msg.rngSeed);
  else if (type === 'immigrate') result = immigrate(msg.migrants, msg.rngSeed);
  else return;
  parentPort.postMessage({ id, ...result });
});

parentPort.postMessage({ type: 'ready', index });
