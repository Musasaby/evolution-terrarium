// 長時間・複数シードの多様性計測（ブラウザ不要）
//   npm run check:diversity                     … 既定 18000 ステップ・シード 1,2,3
//   node tools/diversity-check.mjs 18000 2      … ステップ数とシードを指定（カンマ区切りで複数可）
//
// T2 の computeDiversity（src/sim/diversity.js）を使い、0.5 年ごとに
// 個体数・現存種・実効種数・食性ニッチの実効数・食性 3 分類の個体数・
// 移入回数・疫病回数と、区間ごとの ms/ステップを表で表示する。
// シードは子プロセスで並行実行する。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);

function fmt1(v) { return (Math.round(v * 10) / 10).toFixed(1); }

function printTable(r) {
  const head = ['年', '個体数', '現存種', '実効種数', '食性実効', '草', '葉', '肉', '移入', '疫病', 'ms/ステップ'];
  const w = [6, 5, 5, 6, 6, 4, 4, 4, 4, 4, 10];
  console.log(`seed ${r.seed}`);
  console.log('  ' + head.map((h, i) => h.padEnd(w[i] + (i > 0 ? 2 : 0))).join(''));
  for (const row of r.rows) {
    const cells = [
      row.year.toFixed(1), row.pop, row.species, fmt1(row.effSpecies), fmt1(row.effDiet),
      row.diet[0], row.diet[1], row.diet[2], row.invasions, row.plagues, row.msPerStep.toFixed(2),
    ];
    console.log('  ' + cells.map((c, i) => String(c).padEnd(w[i] + (i > 0 ? 2 : 0))).join(''));
  }
  console.log(`  （初期化 ${r.initMs.toFixed(0)} ms・全体 ${r.msPerStepAll.toFixed(2)} ms/ステップ）`);
}

async function runWorker(steps, seed) {
  return new Promise((resolve, reject) => {
    const ps = spawn(process.execPath, [self, '--worker', String(steps), String(seed)], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const out = [];
    ps.stdout.on('data', (b) => out.push(b));
    ps.on('error', reject);
    ps.on('exit', (code) => {
      if (code !== 0) { reject(new Error(`seed ${seed}: 子プロセスが ${code} で終了`)); return; }
      try { resolve(JSON.parse(Buffer.concat(out).toString('utf8'))); }
      catch (e) { reject(new Error(`seed ${seed}: 出力の解析に失敗 - ${e.message}`)); }
    });
  });
}

// 子プロセスとして起動された場合（--worker <ステップ数> <シード>）は 1 シードだけ進めて JSON を出す
const wi = process.argv.indexOf('--worker');
if (wi >= 0) {
  const { runSeed } = await import('./diversity-worker.mjs');
  process.stdout.write(JSON.stringify(await runSeed(+process.argv[wi + 1], +process.argv[wi + 2])));
} else {
  const steps = +(process.argv[2] ?? 18000);
  const seeds = (process.argv[3] ?? '1,2,3').split(',').map(Number).filter(Number.isFinite);
  const results = await Promise.all(seeds.map((seed) => runWorker(steps, seed)));
  console.log(`${steps} ステップ（0.5 年ごとに集計。壁時間 ${Math.max(...results.map((r) => r.elapsed)).toFixed(0)} ms・シードは並行実行）`);
  for (const r of results) printTable(r);
}
