// 群島の結果 JSON をまたいで、条件・シードごとの状態ハッシュを比べる。
//   node tools/scaling/island-hash-compare.mjs <json...>
//
// 各ファイルの runs[] から <間隔>x<人数> とシードごとの hash を集め、Markdown の表にする。
// 行は条件が最初に現れた順、その中でシードの昇順。値が無いファイルは - とする。
// 1 行の全ファイルが同じ値なら「一致」、違う値か - があれば「不一致」。
// すべて一致なら「すべて一致」、そうでなければ「不一致 N 件」を出し、
// 不一致があれば exit 1、なければ exit 0。
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const USAGE = '使い方: node tools/scaling/island-hash-compare.mjs <json...>';

function table(head, rows) {
  const lines = [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
  ];
  for (const cells of rows) lines.push(`| ${cells.join(' | ')} |`);
  return lines.join('\n');
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error(USAGE);
  process.exit(1);
}

const names = files.map((f) => basename(f));
const keys = []; // 条件（最初に現れた順）
const seedsByKey = new Map(); // 条件 -> Set<シード>
// 条件 -> シード -> ファイル番号 -> hash
const hashes = new Map();

for (let fi = 0; fi < files.length; fi++) {
  const data = JSON.parse(await readFile(files[fi], 'utf8'));
  for (const run of data.runs ?? []) {
    const key = `${run.interval}x${run.migrants}`;
    if (!hashes.has(key)) {
      hashes.set(key, new Map());
      seedsByKey.set(key, new Set());
      keys.push(key);
    }
    const bySeed = hashes.get(key);
    if (!bySeed.has(run.seed)) bySeed.set(run.seed, new Map());
    bySeed.get(run.seed).set(fi, String(run.hash));
    seedsByKey.get(key).add(run.seed);
  }
}

const head = ['条件', 'シード', ...names, '結果'];
const rows = [];
let mismatches = 0;

for (const key of keys) {
  const seeds = [...seedsByKey.get(key)].sort((a, b) => a - b);
  const bySeed = hashes.get(key);
  for (const seed of seeds) {
    const perFile = bySeed.get(seed);
    const values = files.map((_, fi) => perFile.get(fi) ?? '-');
    const first = values[0];
    const same = first !== '-' && values.every((v) => v === first);
    if (!same) mismatches++;
    rows.push([key, String(seed), ...values, same ? '一致' : '不一致']);
  }
}

console.log(table(head, rows));
if (mismatches === 0) {
  console.log('すべて一致');
  process.exit(0);
}
console.log(`不一致 ${mismatches} 件`);
process.exit(1);
