// スケーリング検証の結果 JSON を要約する。
//   summarizeRun(run, window) … シードごとの区間中央値と、そのシード平均
//   node tools/scaling/summarize.mjs <json...> … 1 ファイル 1 行の Markdown 表
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CFG } from '../../src/sim/index.js';

function median(xs) {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const FIELDS = ['pop', 'species', 'effSpecies', 'effDiet', 'msPerStep', 'physics'];

export function summarizeRun(run, window) {
  const years = run.steps != null
    ? (run.steps * CFG.DT) / CFG.YEAR
    : (run.results[0]?.rows.at(-1)?.year ?? 0);
  const [from, to] = window ?? [years * 2 / 3, years];

  const seeds = run.results.map((r) => {
    const rows = r.rows.filter((x) => x.year >= from - 1e-6 && x.year <= to + 1e-6);
    const pick = (key) => median(rows.map((x) => x[key]));
    return {
      seed: r.seed,
      pop: pick('pop'),
      species: pick('species'),
      effSpecies: pick('effSpecies'),
      effDiet: pick('effDiet'),
      msPerStep: pick('msPerStep'),
      physics: median(rows.map((x) => x.sections?.['物理'])),
    };
  });

  const avg = {};
  for (const k of FIELDS) {
    const values = seeds.map((s) => s[k]).filter((v) => Number.isFinite(v));
    avg[k] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
  }

  return { window: [from, to], seeds, avg };
}

const HEAD = ['条件', '広さ', 'maxPop', 'maxPlants', '個体数', '現存種', '実効種数', '食性実効', 'ms/ステップ', '物理 ms'];

function fmt(v, digits) {
  return Number.isFinite(v) ? v.toFixed(digits) : '-';
}

export function formatTable(runs) {
  const lines = [
    `| ${HEAD.join(' | ')} |`,
    `| ${HEAD.map(() => '---').join(' | ')} |`,
  ];
  for (const run of runs) {
    const s = run.summary ?? summarizeRun(run);
    const geo = run.results[0]?.geo ?? {};
    const a = s.avg;
    const cells = [
      run.variant ?? '-',
      geo.size ?? '-',
      geo.maxPop ?? '-',
      geo.maxPlants ?? '-',
      fmt(a.pop, 1),
      fmt(a.species, 1),
      fmt(a.effSpecies, 1),
      fmt(a.effDiet, 1),
      fmt(a.msPerStep, 2),
      fmt(a.physics, 2),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const runs = [];
  for (const file of process.argv.slice(2)) {
    runs.push(JSON.parse(await readFile(file, 'utf8')));
  }
  console.log(formatTable(runs));
}
