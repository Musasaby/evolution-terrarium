// シミュレーションの動作確認（ブラウザ不要）
//   npm install && npm run check:sim            … 既定 600 ステップ
//   node tools/sim-check.mjs 1500 12345          … ステップ数とシードを指定
//   node tools/sim-check.mjs 600 1 --settings terrain:mountain  … 世界の設定（テンプレート ID か JSON）を指定
//
// 同じシード・同じステップ数なら必ず同じ「状態ハッシュ」になる。
// リファクタリングの前後でハッシュが変わらなければ、シミュレーションの振る舞いは変わっていない。
// あわせて、処理区間ごとの所要時間（どこが重いか）も表示する。
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim, SectionProfiler } from '../src/sim/index.js';
import { extractSettings } from './settings-arg.mjs';
import { stateHash } from './state-hash.mjs';

const { args, settings, text } = extractSettings(process.argv.slice(2));
const steps = +(args[0] ?? 600);
const seed = +(args[1] ?? 20261007);
await RAPIER.init();

const t0 = performance.now();
const prof = new SectionProfiler();
const sim = new Sim(RAPIER, seed, { profiler: prof, settings });
const initMs = performance.now() - t0;
prof.take();
const t1 = performance.now();
for (let i = 0; i < steps; i++) sim.step();
const runMs = performance.now() - t1;
const sections = prof.take();

const live = sim.creatures.filter(c => c.alive && !c.dead).length;
console.log(`seed ${seed} / ${steps} ステップ（シム ${sim.t.toFixed(1)} 秒）${text ? ` / 設定 ${text}` : ''}`);
console.log(`状態ハッシュ  ${stateHash(sim)}`);
console.log(`生物 ${live} / 植物 ${sim.plants.length} / 種 ${sim.species.size}`);
console.log(`世界の生成 ${initMs.toFixed(0)} ms、1ステップ平均 ${(runMs / steps).toFixed(2)} ms`);
for (const [k, v] of Object.entries(sections)) console.log(`  ${k.padEnd(4, '　')} ${(v.ms / steps).toFixed(2).padStart(7)} ms/ステップ  ${(v.ms / runMs * 100).toFixed(0).padStart(3)}%`);
