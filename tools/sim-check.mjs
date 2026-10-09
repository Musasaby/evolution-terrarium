// シミュレーションの動作確認（ブラウザ不要）
//   npm install && npm run check:sim            … 既定 600 ステップ
//   node tools/sim-check.mjs 1500 12345          … ステップ数とシードを指定
//
// 同じシード・同じステップ数なら必ず同じ「状態ハッシュ」になる。
// リファクタリングの前後でハッシュが変わらなければ、シミュレーションの振る舞いは変わっていない。
// あわせて、処理区間ごとの所要時間（どこが重いか）も表示する。
import RAPIER from '@dimforge/rapier3d-compat';
import { createHash } from 'node:crypto';
import { Sim, SectionProfiler } from '../src/sim/index.js';

const steps = +(process.argv[2] ?? 600);
const seed = +(process.argv[3] ?? 20261007);
await RAPIER.init();

const t0 = performance.now();
const prof = new SectionProfiler();
const sim = new Sim(RAPIER, seed, { profiler: prof });
const initMs = performance.now() - t0;
prof.take();
const t1 = performance.now();
for (let i = 0; i < steps; i++) sim.step();
const runMs = performance.now() - t1;
const sections = prof.take();

const h = createHash('sha1');
const r = (v) => Math.round(v * 1e4) / 1e4;
h.update(JSON.stringify({ t: r(sim.t), counters: sim.counters, nsp: sim.species.size, ev: sim.events.map(e => e.msg) }));
for (const c of sim.creatures) {
  h.update(`${c.id}|${c.alive}|${c.dead}|${r(c.energy)}|${c.species?.id}|${c.gen}`);
  if (c.bodies[0]) { const t = c.bodies[0].translation(); h.update(`${r(t.x)},${r(t.y)},${r(t.z)}`); }
}
for (const p of sim.plants) h.update(`${p.id}|${r(p.energy)}`);
h.update(Array.from(sim.H, r).join(','));

const live = sim.creatures.filter(c => c.alive && !c.dead).length;
console.log(`seed ${seed} / ${steps} ステップ（シム ${sim.t.toFixed(1)} 秒）`);
console.log(`状態ハッシュ  ${h.digest('hex').slice(0, 16)}`);
console.log(`生物 ${live} / 植物 ${sim.plants.length} / 種 ${sim.species.size}`);
console.log(`世界の生成 ${initMs.toFixed(0)} ms、1ステップ平均 ${(runMs / steps).toFixed(2)} ms`);
for (const [k, v] of Object.entries(sections)) console.log(`  ${k.padEnd(4, '　')} ${(v.ms / steps).toFixed(2).padStart(7)} ms/ステップ  ${(v.ms / runMs * 100).toFixed(0).padStart(3)}%`);
