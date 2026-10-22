// diversity-check.mjs の子プロセス側：1 シードを進めて結果を JSON で stdout へ出す
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim, CFG, computeDiversity } from '../src/sim/index.js';

// 0.25 年ごとの区間（ステップ数）。既定 27000 ステップ = 3 年 = 12 区間
const INTERVAL_STEPS = Math.round((CFG.YEAR / 4) / CFG.DT);
const DIET_EDGE = [0.25, 0.75]; // diversity.js と同じ分類：<0.25=草, <0.75=葉, 以上=肉

export async function runSeed(steps, seed, settings) {
  await RAPIER.init();
  const t0 = performance.now();
  const sim = new Sim(RAPIER, seed, { settings });
  const initMs = performance.now() - t0;

  // 移入・疫病はイベントログで数える（sim 本体には手を入れない）
  let invasions = 0, plagues = 0;
  sim.on('log', ({ msg }) => {
    if (msg.includes('群れが移入した')) invasions++;
    if (msg.includes('流行し始めた')) plagues++;
  });

  const rows = [];
  let t1 = performance.now(), intervalMs = 0;
  const snapshot = (year, n) => {
    const div = computeDiversity(sim);
    const diet = [0, 0, 0];
    for (const c of sim.creatures) {
      if (!c.alive || c.dead) continue;
      const d = c.genome.diet ?? 0.25;
      diet[d < DIET_EDGE[0] ? 0 : d < DIET_EDGE[1] ? 1 : 2]++;
    }
    intervalMs = performance.now() - t1;
    t1 = performance.now();
    let plantSoft = 0, plantHard = 0;
    for (const p of sim.plants) { if (p.sp.soft) plantSoft++; else plantHard++; }
    rows.push({
      year, pop: div.living, species: div.species, plantSoft, plantHard,
      effSpecies: div.effSpecies, effDiet: div.effDiet, diet,
      invasions, plagues,
      msPerStep: intervalMs / n,
    });
  };

  const tRun0 = performance.now();
  for (let done = 0; done < steps; done += INTERVAL_STEPS) {
    const n = Math.min(INTERVAL_STEPS, steps - done);
    for (let i = 0; i < n; i++) sim.step();
    snapshot(((done + n) * CFG.DT) / CFG.YEAR, n);
  }
  const runMs = performance.now() - tRun0;

  return { seed, years: ((steps * CFG.DT) / CFG.YEAR), initMs, runMs, msPerStepAll: runMs / steps, elapsed: performance.now() - t0, rows };
}
