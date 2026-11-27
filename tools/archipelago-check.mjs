// 群島（複数の島 = 独立した Sim）の動作確認（ブラウザ不要）
//   node tools/archipelago-check.mjs [ステップ数=600] [シード=20261007] [--settings ...]
//
// 同じシード・同じステップ数・同じ設定なら必ず同じ「状態ハッシュ」になる。
// 島が 1 つなら単一世界の sim-check と同じ値になる。
import RAPIER from '@dimforge/rapier3d-compat';
import { Archipelago, computeArchipelagoDiversity } from '../src/sim/index.js';
import { extractSettings } from './settings-arg.mjs';
import { stateHash, archipelagoHash } from './state-hash.mjs';

const { args, settings } = extractSettings(process.argv.slice(2));
const steps = +(args[0] ?? 600);
const seed = +(args[1] ?? 20261007);
await RAPIER.init();

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
console.log(`移住 ${arch.migrated}（捨て ${arch.dropped}）`);
const div = computeArchipelagoDiversity(arch.sims);
console.log(`個体数 ${div.living}・実効種数 ${div.effSpecies.toFixed(2)}・交配で束ねた実効種数 ${div.effSpeciesFertile.toFixed(2)}（${div.species} 種 → ${div.speciesFertile} 種）`);
console.log(`1 ステップ平均 ${(runMs / steps).toFixed(2)} ms`);
