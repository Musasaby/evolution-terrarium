// 群島と単一世界の結果 JSON を、検証記録に貼る 3 つの表にまとめる。
//   node tools/scaling/island-summary.mjs <json...>
//
// islands が 1 のファイルは単一世界（size で区別）、2 以上は群島
// （runs[] の <間隔>x<人数> で区別）として扱う。値は各 run の summary を使い、
// 同じ条件の run を平均する（シード平均）。
import { readFile } from 'node:fs/promises';

const USAGE = '使い方: node tools/scaling/island-summary.mjs <json...>';

function fmt(v, digits) {
  return Number.isFinite(v) ? v.toFixed(digits) : '-';
}

function avgField(runs, key) {
  const values = runs.map((r) => r.summary?.[key]).filter((v) => Number.isFinite(v));
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
}

function averageRuns(runs) {
  const fields = [
    'effSpecies', 'effSpeciesFertile', 'effSpeciesLineage', 'islandEffSpecies',
    'pop', 'islandPop', 'cpuMsPerStep', 'cpuMsPerIndividual', 'msPerStep',
  ];
  const out = {};
  for (const k of fields) out[k] = avgField(runs, k);
  return out;
}

function table(head, rows) {
  const lines = [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
  ];
  for (const cells of rows) lines.push(`| ${cells.join(' | ')} |`);
  return lines.join('\n');
}

function ratio(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : undefined;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error(USAGE);
  process.exit(1);
}

const archGroups = new Map(); // 条件 -> runs[]（最初に現れた順）
const singleGroups = new Map(); // 広さ -> runs[]

for (const file of files) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (data.islands === 1) {
    const size = data.size;
    if (!singleGroups.has(size)) singleGroups.set(size, []);
    singleGroups.get(size).push(...data.runs);
  } else if (data.islands >= 2) {
    for (const run of data.runs) {
      const cond = `${run.interval}x${run.migrants}`;
      if (!archGroups.has(cond)) archGroups.set(cond, []);
      archGroups.get(cond).push(run);
    }
  }
}

const arch = [...archGroups].map(([cond, runs]) => ({ cond, runs, avg: averageRuns(runs) }));
const single = [...singleGroups]
  .map(([size, runs]) => ({ size, runs, avg: averageRuns(runs) }))
  .sort((a, b) => a.size - b.size);

const blocks = [];

if (arch.length) {
  const base = arch.find((g) => g.cond === '0x0');
  const head = [
    '条件', '群島 実効種数(島:種)', '交配で束ねる', '0x0 比', '由来で束ねる',
    '島平均 実効種数', '群島 個体数', '島平均 個体数',
    'CPU ms/ステップ', 'CPU ms/個体', '壁 ms/ステップ',
  ];
  const rows = arch.map((g) => {
    const a = g.avg;
    return [
      g.cond,
      fmt(a.effSpecies, 1),
      fmt(a.effSpeciesFertile, 1),
      fmt(base ? ratio(a.effSpeciesFertile, base.avg.effSpeciesFertile) : undefined, 2),
      fmt(a.effSpeciesLineage, 1),
      fmt(a.islandEffSpecies, 1),
      fmt(a.pop, 1),
      fmt(a.islandPop, 1),
      fmt(a.cpuMsPerStep, 2),
      fmt(a.cpuMsPerIndividual, 3),
      fmt(a.msPerStep, 2),
    ];
  });
  blocks.push(`### 群島\n${table(head, rows)}`);
}

if (single.length) {
  const head = ['広さ', '個体数', '実効種数', 'CPU ms/ステップ', 'CPU ms/個体'];
  const rows = single.map((g) => {
    const a = g.avg;
    return [
      g.size,
      fmt(a.pop, 1),
      fmt(a.effSpecies, 1),
      fmt(a.cpuMsPerStep, 2),
      fmt(a.cpuMsPerIndividual, 3),
    ];
  });
  blocks.push(`### 単一世界\n${table(head, rows)}`);
}

if (arch.length && single.length) {
  const head = [
    '条件', '群島 個体数', '単一世界',
    '実効種数 群島(交配)', '実効種数 単一', '比',
    'CPU ms/ステップ 群島', 'CPU ms/ステップ 単一', '比',
    'CPU ms/個体 群島', 'CPU ms/個体 単一', '比',
  ];
  const rows = arch.map((g) => {
    const a = g.avg;
    const target = single.reduce((best, s) => {
      if (!best) return s;
      const d = Math.abs(s.avg.pop - a.pop);
      const bd = Math.abs(best.avg.pop - a.pop);
      if (d < bd) return s;
      if (d === bd && s.size < best.size) return s;
      return best;
    }, null);
    return [
      g.cond,
      fmt(a.pop, 1),
      `${target.size} m(${fmt(target.avg.pop, 1)} 体)`,
      fmt(a.effSpeciesFertile, 1),
      fmt(target.avg.effSpecies, 1),
      fmt(ratio(a.effSpeciesFertile, target.avg.effSpecies), 2),
      fmt(a.cpuMsPerStep, 2),
      fmt(target.avg.cpuMsPerStep, 2),
      fmt(ratio(a.cpuMsPerStep, target.avg.cpuMsPerStep), 2),
      fmt(a.cpuMsPerIndividual, 3),
      fmt(target.avg.cpuMsPerIndividual, 3),
      fmt(ratio(a.cpuMsPerIndividual, target.avg.cpuMsPerIndividual), 2),
    ];
  });
  blocks.push(`### 個体数をそろえた比較\n${table(head, rows)}`);
}

console.log(blocks.join('\n\n'));
