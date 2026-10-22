// 長時間・複数シードの多様性計測（ブラウザ不要）
//   npm run check:diversity                     … 既定 27000 ステップ（3 年）・シード 1,2,3
//   node tools/diversity-check.mjs 27000 2      … ステップ数とシードを指定（カンマ区切りで複数可）
//   node tools/diversity-check.mjs 9000 1 --settings climate:cold  … 世界の設定（テンプレート ID か JSON）を指定
//
// T2 の computeDiversity（src/sim/diversity.js）を使い、0.25 年ごとに
// 個体数・現存種・実効種数・食性ニッチの実効数・食性 3 分類の個体数・
// 移入回数・疫病回数と、区間ごとの ms/ステップを表で表示する。
// シードは子プロセスで並行実行する。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractSettings } from './settings-arg.mjs';

const self = fileURLToPath(import.meta.url);

function fmt1(v) { return (Math.round(v * 10) / 10).toFixed(1); }

function printTable(r) {
  const head = ['年', '個体数', '現存種', '実効種数', '食性実効', '草', '葉', '肉', '草類', '木類', '移入', '疫病', 'ms/ステップ'];
  const w = [6, 5, 5, 6, 6, 4, 4, 4, 4, 4, 4, 4, 10];
  console.log(`seed ${r.seed}`);
  console.log('  ' + head.map((h, i) => h.padEnd(w[i] + (i > 0 ? 2 : 0))).join(''));
  for (const row of r.rows) {
    const cells = [
      row.year.toFixed(2), row.pop, row.species, fmt1(row.effSpecies), fmt1(row.effDiet),
      row.diet[0], row.diet[1], row.diet[2], row.plantSoft, row.plantHard, row.invasions, row.plagues, row.msPerStep.toFixed(2),
    ];
    console.log('  ' + cells.map((c, i) => String(c).padEnd(w[i] + (i > 0 ? 2 : 0))).join(''));
  }
  console.log(`  （初期化 ${r.initMs.toFixed(0)} ms・全体 ${r.msPerStepAll.toFixed(2)} ms/ステップ）`);
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 2〜3 年の区間の中央値で成功基準を判定する
function printVerdict(results) {
  console.log('');
  const per = [];
  for (const r of results) {
    const rows = r.rows.filter((x) => x.year >= 2 - 1e-6 && x.year <= 3 + 1e-6);
    if (rows.length === 0) continue;
    per.push({
      seed: r.seed,
      pop: median(rows.map((x) => x.pop)),
      eff: median(rows.map((x) => x.effSpecies)),
      diet: median(rows.map((x) => x.effDiet)),
      inv: rows[rows.length - 1].invasions - rows[0].invasions,
    });
  }
  if (per.length === 0) { console.log('判定: 2〜3 年の区間が無いため省略'); return; }
  console.log('判定（2〜3 年の区間の中央値）');
  for (const p of per) {
    console.log(`  seed ${p.seed}: 個体数 ${fmt1(p.pop)}・実効種数 ${fmt1(p.eff)}・食性実効 ${fmt1(p.diet)}・2〜3 年の移入 ${p.inv} 回`);
  }
  const n = per.length;
  const avgEff = per.reduce((a, p) => a + p.eff, 0) / n;
  const avgDiet = per.reduce((a, p) => a + p.diet, 0) / n;
  const noInv = per.filter((p) => p.inv === 0).length;
  const minEff = Math.min(...per.map((p) => p.eff));
  const minPop = Math.min(...per.map((p) => p.pop));
  console.log(`  平均: 実効種数 ${fmt1(avgEff)}・食性実効 ${fmt1(avgDiet)}・移入なし ${noInv}/${n}`);
  const mark = (ok) => (ok ? '○' : '×');
  console.log(`  ${mark(avgEff >= 6)} 実効種数の平均 6 以上（実測 ${fmt1(avgEff)}）`);
  console.log(`  ${mark(minEff >= 5)} 各シードの実効種数 5 以上（最小 ${fmt1(minEff)}）`);
  console.log(`  ${mark(minPop >= 80)} 各シードの個体数 80 以上（最小 ${fmt1(minPop)}）`);
  console.log(`  ${mark(avgDiet >= 2.2)} 食性ニッチの実効数の平均 2.2 以上（実測 ${fmt1(avgDiet)}）`);
  console.log(`  ${mark(noInv * 2 > n)} 2〜3 年に移入が起きないシードが過半（${noInv}/${n}）`);
}

async function runWorker(steps, seed, settingsText) {
  return new Promise((resolve, reject) => {
    const ps = spawn(process.execPath, [self, ...(settingsText ? ['--settings', settingsText] : []), '--worker', String(steps), String(seed)], {
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
const { args, settings, text: settingsText } = extractSettings(process.argv.slice(2));
const wi = args.indexOf('--worker');
if (wi >= 0) {
  const { runSeed } = await import('./diversity-worker.mjs');
  process.stdout.write(JSON.stringify(await runSeed(+args[wi + 1], +args[wi + 2], settings)));
} else {
  const steps = +(args[0] ?? 27000);
  const seeds = (args[1] ?? '1,2,3').split(',').map(Number).filter(Number.isFinite);
  const results = await Promise.all(seeds.map((seed) => runWorker(steps, seed, settingsText)));
  if (settingsText) console.log(`世界の設定: ${settingsText}`);
  console.log(`${steps} ステップ（0.25 年ごとに集計。壁時間 ${Math.max(...results.map((r) => r.elapsed)).toFixed(0)} ms・シードは並行実行）`);
  for (const r of results) printTable(r);
  printVerdict(results);
}
