// 群島（複数の島 = 独立した Sim）の動作確認（ブラウザ不要）
//   node tools/archipelago-check.mjs [ステップ数=600] [シード=20261007] [--settings ...] [--workers] [--jitter]
//
// 同じシード・同じステップ数・同じ設定なら必ず同じ「状態ハッシュ」になる。
// 島が 1 つなら単一世界の sim-check と同じ値になる。
// --workers で島ごとの worker_threads に分けて動かす（--jitter で応答順を揺らす）。
import { Worker } from 'node:worker_threads';
import RAPIER from '@dimforge/rapier3d-compat';
import { Archipelago, ParallelArchipelago, createPort, computeArchipelagoDiversity, normalizeSettings } from '../src/sim/index.js';
import { extractSettings } from './settings-arg.mjs';
import { stateHash, archipelagoHash, combineIslandHashes } from './state-hash.mjs';

const rawArgs = process.argv.slice(2);
const workersFlag = rawArgs.includes('--workers');
const jitter = rawArgs.includes('--jitter');
const argv = rawArgs.filter((a) => a !== '--workers' && a !== '--jitter');
const { args, settings } = extractSettings(argv);
const steps = +(args[0] ?? 600);
const seed = +(args[1] ?? 20261007);
await RAPIER.init();

if (workersFlag) {
  const n = normalizeSettings(settings).islands;
  const workers = [];
  const ports = [];
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL('./island-thread.mjs', import.meta.url), { workerData: { jitter } });
    const port = createPort((m, t) => w.postMessage(m, t), (fn) => w.on('message', fn));
    w.on('error', (e) => port.failAll(e));
    workers.push(w);
    ports.push(port);
  }
  try {
    const arch = new ParallelArchipelago(ports, seed, settings);
    await arch.init();
    const t0 = performance.now();
    await arch.advance(steps);
    const wallMs = performance.now() - t0;
    const hs = (await Promise.all(ports.map((p) => p.ask('hash')))).map((m) => m.hash);

    const side = n === 1 ? arch.settings.size : arch.settings.islandSize;
    console.log(`seed ${seed} / ${steps} ステップ / 島 ${n}（一辺 ${side} m）/ 移住 ${arch.settings.migrateEvery} ステップごと ${arch.settings.migrants} 体（worker ${n} 個${jitter ? '・応答を揺らす' : ''}）`);
    console.log(`状態ハッシュ  ${combineIslandHashes(hs)}`);
    hs.forEach((h, i) => console.log(`  島 ${i}: ハッシュ ${h}`));
    console.log(`移住 ${arch.migrated}（捨て ${arch.dropped}・少数で見送り ${arch.skipped}）`);
    const cpuMs = arch.computeMs.reduce((a, b) => a + b, 0);
    console.log(`1 ステップ平均 ${(wallMs / steps).toFixed(2)} ms（壁時間。CPU 合計 ${(cpuMs / steps).toFixed(2)} ms）`);
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
} else {
  const arch = new Archipelago(RAPIER, seed, { settings });
  const n = arch.settings.islands;
  const side = n === 1 ? arch.settings.size : arch.settings.islandSize;
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) arch.step();
  const runMs = performance.now() - t0;

  console.log(`seed ${seed} / ${steps} ステップ / 島 ${n}（一辺 ${side} m）/ 移住 ${arch.settings.migrateEvery} ステップごと ${arch.settings.migrants} 体`);
  console.log(`状態ハッシュ  ${archipelagoHash(arch)}`);
  arch.islands.forEach((isl, i) => {
    const sim = isl.sim;
    const live = sim.creatures.filter(c => c.alive && !c.dead).length;
    console.log(`  島 ${i}: 生物 ${live} / 植物 ${sim.plants.length} / 種 ${sim.species.size} / ハッシュ ${stateHash(sim)}`);
  });
  console.log(`移住 ${arch.migrated}（捨て ${arch.dropped}・少数で見送り ${arch.skipped}）`);
  const div = computeArchipelagoDiversity(arch.sims);
  console.log(`個体数 ${div.living}・実効種数 ${div.effSpecies.toFixed(2)}・交配で束ねた実効種数 ${div.effSpeciesFertile.toFixed(2)}（${div.species} 種 → ${div.speciesFertile} 種）`);
  let goneButListed = 0;
  for (const sim of arch.sims) for (const sp of sim.species.values()) if (sp.extinct === null && sp.count === 0) goneButListed++;
  console.log(`現存なのに個体 0 の種 ${goneButListed}`);
  console.log(`1 ステップ平均 ${(runMs / steps).toFixed(2)} ms`);
}
