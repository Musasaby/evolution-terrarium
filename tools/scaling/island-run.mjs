// 島モデルの試作：独立した世界を worker_threads で並行に動かし、ときどき少数を移住させる
//   node tools/scaling/island-run.mjs [--islands 4] [--size 80] [--steps 27000] [--seeds 1]
//     [--conditions 0x0,1500x2] [--out <path>]
//
// 条件は <間隔>x<人数>。間隔 0 は移住なし。島 i のシードは seed * 100 + i。
// シードは並行に、条件は順に実行する。
// 2250 ステップ（0.25 年）ごとに全島の stats を集め、島ごとの値と群島全体の値を記録する。
import { Worker } from 'node:worker_threads';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CFG } from '../../src/sim/index.js';

const workerUrl = new URL('./island-worker.mjs', import.meta.url);

const STAT_INTERVAL = 2250; // 0.25 年（300 秒 / 30 Hz / 4）

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--islands') out.islands = argv[++i];
    else if (a === '--size') out.size = argv[++i];
    else if (a === '--steps') out.steps = argv[++i];
    else if (a === '--seeds') out.seeds = argv[++i];
    else if (a === '--conditions') out.conditions = argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  return out;
}

function parseConditions(text) {
  return (text ?? '0x0').split(',').filter(Boolean).map((s) => {
    const [i, k] = s.split('x').map(Number);
    return { interval: Number.isFinite(i) ? i : 0, migrants: Number.isFinite(k) ? k : 0 };
  });
}

function spawnIsland(data) {
  const worker = new Worker(workerUrl, { workerData: data });
  let seq = 0;
  const pending = new Map();
  let readyResolve, readyReject;
  const ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
  let failed = null;

  worker.on('message', (m) => {
    if (m && m.type === 'ready') { readyResolve(); return; }
    const p = pending.get(m && m.id);
    if (p) { pending.delete(m.id); p.resolve(m); }
  });
  worker.on('error', (err) => {
    failed = err;
    readyReject(err);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  });
  worker.on('exit', (code) => {
    if (code !== 0 && !failed) {
      const err = new Error(`島 ${data.index} の worker が ${code} で終了`);
      readyReject(err);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    }
  });

  return {
    ready,
    ask(type, payload = {}) {
      if (failed) return Promise.reject(failed);
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, type, ...payload });
      });
    },
    terminate() { return worker.terminate(); },
  };
}

function effFromCounts(counts) {
  const n = counts.reduce((a, b) => a + b, 0);
  if (!n) return 0;
  let h = 0;
  for (const k of counts) if (k > 0) { const p = k / n; h -= p * Math.log(p); }
  return Math.exp(h);
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function buildRow(step, wallMs, stepsRun, statsList, computeList) {
  const islands = statsList.map((st, i) => {
    const msPerStep = computeList[i].computeMs / stepsRun;
    return {
      index: i,
      pop: st.living,
      species: st.speciesCounts.length,
      effSpecies: st.div.effSpecies,
      effDiet: st.div.effDiet,
      diet: st.dietCounts,
      msPerStep,
      msPerIndividual: st.living > 0 ? msPerStep / st.living : 0,
    };
  });

  // 群島全体：種は「島番号:sp.id」を別の種として数える
  const spCounts = new Map();
  const dietCounts = [0, 0, 0];
  let pop = 0, species = 0;
  for (let i = 0; i < statsList.length; i++) {
    const st = statsList[i];
    pop += st.living;
    species += st.speciesCounts.length;
    for (const [id, n] of st.speciesCounts) spCounts.set(`${i}:${id}`, n);
    for (let d = 0; d < 3; d++) dietCounts[d] += st.dietCounts[d];
  }
  const effSpecies = effFromCounts([...spCounts.values()]);
  const effDiet = effFromCounts(dietCounts);
  const msPerStep = wallMs / stepsRun;

  return {
    step,
    year: (step * CFG.DT) / CFG.YEAR,
    archipelago: {
      pop,
      species,
      effSpecies,
      effDiet,
      diet: dietCounts,
      msPerStep,
      msPerIndividual: pop > 0 ? msPerStep / pop : 0,
    },
    islands,
  };
}

function summarize(rows, steps) {
  const years = (steps * CFG.DT) / CFG.YEAR;
  const lo = years * 2 / 3 - 1e-6, hi = years + 1e-6;
  const sel = rows.filter((r) => r.year >= lo && r.year <= hi);
  const pick = (fn) => median(sel.map(fn));
  return {
    fromYear: lo,
    toYear: years,
    rows: sel.length,
    pop: pick((r) => r.archipelago.pop),
    species: pick((r) => r.archipelago.species),
    effSpecies: pick((r) => r.archipelago.effSpecies),
    effDiet: pick((r) => r.archipelago.effDiet),
    msPerStep: pick((r) => r.archipelago.msPerStep),
    msPerIndividual: pick((r) => r.archipelago.msPerIndividual),
  };
}

async function runOne(seed, interval, k, opts) {
  const { islands: nIslands, size, steps } = opts;
  const workers = [];
  for (let i = 0; i < nIslands; i++) {
    workers.push(spawnIsland({ index: i, seed: seed * 100 + i, size }));
  }
  try {
    await Promise.all(workers.map((w) => w.ready));

    const chunk = interval > 0 ? gcd(interval, STAT_INTERVAL) : STAT_INTERVAL;
    const rows = [];
    let migrated = 0, dropped = 0;
    let done = 0;

    // 区間（STAT_INTERVAL ステップ）全体の壁時間と、島ごとの computeMs を足し込む。
    // chunk が STAT_INTERVAL より短い場合（間隔が 2250 未満のとき）、最後の 1 chunk
    // だけを測ると移住のやり取りやその前の区切りが抜けて比較が歪むため。
    let intervalWallMs = 0;
    let intervalSteps = 0;
    let intervalCompute = new Array(nIslands).fill(0);

    while (done < steps) {
      const n = Math.min(chunk, steps - done);
      const t0 = performance.now();
      const computeList = await Promise.all(workers.map((w) => w.ask('run', { steps: n })));
      done += n;

      if (interval > 0 && done % interval === 0) {
        const ems = await Promise.all(workers.map((w, i) =>
          w.ask('emigrate', { k, rngSeed: seed * 1e6 + done + i })));
        const imm = await Promise.all(workers.map((w, i) => {
          const src = (i - 1 + nIslands) % nIslands;
          return w.ask('immigrate', { migrants: ems[src].migrants, rngSeed: seed * 1e6 + done + src });
        }));
        for (const r of imm) { migrated += r.placed; dropped += r.dropped; }
      }
      const wallMs = performance.now() - t0;

      intervalWallMs += wallMs;
      intervalSteps += n;
      for (let i = 0; i < nIslands; i++) intervalCompute[i] += computeList[i].computeMs;

      if (done % STAT_INTERVAL === 0) {
        const statsList = await Promise.all(workers.map((w) => w.ask('stats')));
        rows.push(buildRow(
          done,
          intervalWallMs,
          intervalSteps,
          statsList,
          intervalCompute.map((computeMs) => ({ computeMs })),
        ));
        intervalWallMs = 0;
        intervalSteps = 0;
        intervalCompute = new Array(nIslands).fill(0);
      }
    }

    return {
      seed,
      interval,
      migrants: k,
      rows,
      migrated,
      dropped,
      summary: summarize(rows, steps),
    };
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
}

const args = parseArgs(process.argv.slice(2));
const islands = +(args.islands ?? 4);
const size = +(args.size ?? 80);
const steps = +(args.steps ?? 27000);
const seeds = (args.seeds ?? '1').split(',').map(Number).filter(Number.isFinite);
const conditions = parseConditions(args.conditions);

const runs = [];
for (const { interval, migrants } of conditions) {
  const results = await Promise.all(seeds.map((seed) => runOne(seed, interval, migrants, { islands, size, steps })));
  runs.push(...results);
  for (const r of results) {
    const s = r.summary;
    console.log(`seed ${r.seed}・間隔 ${r.interval}・${r.migrants} 体：移住 ${r.migrated}（捨て ${r.dropped}）・`
      + `個体数 ${s.pop.toFixed(1)}・実効種数 ${s.effSpecies.toFixed(2)}・食性実効 ${s.effDiet.toFixed(2)}・`
      + `${s.msPerStep.toFixed(3)} ms/ステップ`);
  }
}

const result = {
  date: new Date().toISOString(),
  islands,
  size,
  steps,
  runs,
};

if (args.out) {
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(result, null, 2));
  console.log(`書き出しました: ${args.out}`);
}
