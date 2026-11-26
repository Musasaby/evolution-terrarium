// 結果 JSON(run.mjs の出力)を読み、シードごとの predations・births・matings・肉からの獲得量を表にする
//   node tools/scaling/predation-table.mjs <json...>
// 同じ variant のファイルを複数渡すと、variant ごとに全シードの平均の行(seed 欄は "平均")も出す
import { readFile } from 'node:fs/promises';

const files = process.argv.slice(2);
const byVariant = new Map(); // variant -> 行の配列
for (const f of files) {
  const run = JSON.parse(await readFile(f, 'utf8'));
  for (const r of run.results) {
    const row = {
      variant: run.variant, seed: r.seed,
      predations: r.counters.predations, births: r.counters.births, matings: r.counters.matings,
      meat: r.feedStats.meat,
    };
    if (!byVariant.has(run.variant)) byVariant.set(run.variant, []);
    byVariant.get(run.variant).push(row);
  }
}
// 出力は Markdown の表。列は「条件 | シード | predations | births | matings | meat」。
// variant ごとにシードの昇順で行を出し、続けて平均の行を出す。
// 数値は predations・births・matings が整数(平均の行は小数 1 桁)、meat は小数 0 桁で丸める

const HEAD = ['条件', 'シード', 'predations', 'births', 'matings', 'meat'];

function fmtInt(v) {
  return Number.isFinite(v) ? Math.round(v).toString() : '-';
}

function fmtAvg(v) {
  return Number.isFinite(v) ? v.toFixed(1) : '-';
}

function fmtMeat(v) {
  return Number.isFinite(v) ? Math.round(v).toString() : '-';
}

const lines = [
  `| ${HEAD.join(' | ')} |`,
  `| ${HEAD.map(() => '---').join(' | ')} |`,
];

for (const [variant, rows] of byVariant) {
  rows.sort((a, b) => a.seed - b.seed);
  for (const row of rows) {
    const cells = [
      variant,
      String(row.seed),
      fmtInt(row.predations),
      fmtInt(row.births),
      fmtInt(row.matings),
      fmtMeat(row.meat),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  const avg = (key) => {
    const values = rows.map((r) => r[key]).filter((v) => Number.isFinite(v));
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
  };
  const cells = [
    variant,
    '平均',
    fmtAvg(avg('predations')),
    fmtAvg(avg('births')),
    fmtAvg(avg('matings')),
    fmtMeat(avg('meat')),
  ];
  lines.push(`| ${cells.join(' | ')} |`);
}

console.log(lines.join('\n'));
