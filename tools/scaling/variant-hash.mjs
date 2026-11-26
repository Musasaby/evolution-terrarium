// 条件（variant）をかけたシミュレーションの状態ハッシュを出す（ブラウザ不要）
//   node tools/scaling/variant-hash.mjs <variant> [ステップ数=600] [シード=20261007]
//
// 旧方式を再現する条件が、変更前の sim と同じハッシュになるかを確かめるために使う。
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim } from '../../src/sim/index.js';
import { stateHash } from '../state-hash.mjs';
import { getVariant } from './variants.mjs';

const name = process.argv[2];
const steps = +(process.argv[3] ?? 600);
const seed = +(process.argv[4] ?? 20261007);

let variant;
try {
  variant = getVariant(name);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

await RAPIER.init();
const sim = new Sim(RAPIER, seed, {});
variant.prepare(sim, RAPIER);
for (let i = 0; i < steps; i++) sim.step();
console.log(`${name} seed ${seed} / ${steps} ステップ 状態ハッシュ ${stateHash(sim)}`);
