// 別の個体どうしの体節のめり込みを測る（ブラウザでの見た目確認の代わり）
//   node tools/scaling/overlap-check.mjs --variants base,hooks [--steps 9000] [--seed 1] [--every 30] [--out <path>]
//
// 条件ごとに同じプロセスの中で順に Sim を進め、every ステップごとに
// 根の体節が近い個体の組について、体節コライダ同士の最小距離からめり込み深さを出す。
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getVariant } from './variants.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--variants') out.variants = argv[++i];
    else if (a === '--steps') out.steps = argv[++i];
    else if (a === '--seed') out.seed = argv[++i];
    else if (a === '--every') out.every = argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  return out;
}

// 昇順に並べた配列のパーセンタイル（線形補間）。空なら undefined。
function percentile(sorted, p) {
  if (sorted.length === 0) return undefined;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// 1 標本を取る。根の体節どうしが 3 未満の個体の組だけを調べ、
// 体節コライダの最小距離が負なら、その絶対値をめり込み深さ pen とする。
function sampleOverlap(sim, samePens, diffPens) {
  const live = sim.creatures.filter((c) => c.alive && !c.dead && c.pos?.[0]);
  for (let i = 0; i < live.length; i++) {
    const a = live[i];
    const p = a.pos[0];
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j];
      const q = b.pos[0];
      if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) >= 3) continue;

      let minD = Infinity;
      for (const ca of a.cols) {
        for (const cb of b.cols) {
          const hit = ca.contactCollider(cb, 0);
          if (hit && Number.isFinite(hit.distance) && hit.distance < minD) minD = hit.distance;
        }
      }
      const pen = minD < 0 ? -minD : 0;
      if (a.id % 16 === b.id % 16) samePens.push(pen);
      else diffPens.push(pen);
    }
  }
}

function summarize(pens) {
  const sorted = [...pens].sort((a, b) => a - b);
  let over001 = 0, over01 = 0;
  for (const pen of sorted) {
    if (pen > 0.01) over001++;
    if (pen > 0.1) over01++;
  }
  return {
    pairs: sorted.length,
    over001,
    over01,
    p50: percentile(sorted, 0.5) ?? 0,
    p95: percentile(sorted, 0.95) ?? 0,
    max: sorted.length ? sorted[sorted.length - 1] : 0,
  };
}

const opts = parseArgs(process.argv.slice(2));
const names = (opts.variants ?? '').split(',').map((s) => s.trim()).filter(Boolean);
try {
  if (names.length === 0) throw new Error('--variants を指定してください');
  for (const name of names) getVariant(name);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const steps = +(opts.steps ?? 9000);
const seed = +(opts.seed ?? 1);
const every = +(opts.every ?? 30);

const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
const { Sim } = await import('../../src/sim/index.js');
await RAPIER.init();

const results = {};
for (const name of names) {
  const variant = getVariant(name);
  const sim = new Sim(RAPIER, seed, {});
  variant.prepare(sim, RAPIER);
  const samePens = [], diffPens = [];
  for (let s = 0; s < steps; s++) {
    sim.step();
    if (every > 0 && (s + 1) % every === 0) sampleOverlap(sim, samePens, diffPens);
  }
  results[name] = { same: summarize(samePens), diff: summarize(diffPens) };
}

const report = {
  date: new Date().toISOString(),
  steps,
  seed,
  every,
  results,
};

if (opts.out) {
  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify(report, null, 2));
}

for (const name of names) {
  const { same, diff } = results[name];
  const fmt = (x) => `pairs=${x.pairs} over01=${x.over01} p95=${x.p95.toFixed(4)} max=${x.max.toFixed(4)}`;
  console.log(`${name}: same ${fmt(same)} | diff ${fmt(diff)}`);
}
