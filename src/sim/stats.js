// ===== 統計の記録（グラフ用の時系列） =====
import { isLiving } from './creatures.js';

const MAX_SAMPLES = 3000;

export function recordStats(sim) {
  const live = sim.creatures.filter(isLiving);
  const n = live.length;
  let parts = 0, vol = 0, maxParts = 0;
  for (const c of live) { parts += c.nParts; vol += c.vol; maxParts = Math.max(maxParts, c.nParts); }
  const spAlive = new Set(live.map(c => c.species.id)).size;
  const L = sim.litters;
  sim.stats.push({
    t: sim.t, pop: n, plants: sim.plants.length, species: spAlive,
    parts: n ? parts / n : 0, vol: n ? vol / n : 0, maxParts,
    temp: sim.climate.temp, water: sim.climate.water, plantCounts: sim.flora.countBySpecies(),
    births: sim.counters.births, deaths: sim.counters.deaths,
    litter: L.length ? L.reduce((a, b) => a + b, 0) / L.length : 0,
  });
  // 古いサンプルは間引いて、長く回しても配列が伸び続けないようにする
  if (sim.stats.length > MAX_SAMPLES) sim.stats = sim.stats.filter((_, i) => i % 2 === 0);
}
