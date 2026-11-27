// 群島の多様性を複数シードで長く測る（ブラウザ不要）
//   npm run check:archipelago-diversity
//   node tools/archipelago-diversity.mjs [ステップ数=27000] [シード=1,2,3] [--settings ...] [--out <path>]
//
// 0.25 年（2250 ステップ）ごとに computeArchipelagoDiversity を記録し、
// 末尾 1/3 の区間の中央値をシードごとに出す。シードは子プロセスで並行実行する。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CFG, normalizeSettings } from '../src/sim/index.js';
import { extractSettings } from './settings-arg.mjs';

const self = fileURLToPath(import.meta.url);
const STAT_INTERVAL = 2250; // 0.25 年（300 秒 / 30 Hz / 4）

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function fmt1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
function fmt2(v) { return v.toFixed(2); }

// island-run.mjs の summarize と同じ区間（末尾 1/3）の中央値
function summarize(rows, steps) {
  const years = (steps * CFG.DT) / CFG.YEAR;
  const lo = years * 2 / 3 - 1e-6, hi = years + 1e-6;
  const sel = rows.filter((r) => r.year >= lo && r.year <= hi);
  const pick = (fn) => (sel.length ? median(sel.map(fn)) : 0);
  return {
    fromYear: lo,
    toYear: years,
    rows: sel.length,
    pop: pick((r) => r.pop),
    species: pick((r) => r.species),
    effSpecies: pick((r) => r.effSpecies),
    effDiet: pick((r) => r.effDiet),
    speciesFertile: pick((r) => r.speciesFertile),
    effSpeciesFertile: pick((r) => r.effSpeciesFertile),
    msPerStep: pick((r) => r.msPerStep),
  };
}

function runChild(steps, seed, settings) {
  return new Promise((resolve) => {
    const ps = spawn(process.execPath, [self, '--child', String(steps), String(seed), JSON.stringify(settings ?? {})], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    ps.stdout.on('data', (b) => out.push(b));
    ps.stderr.on('data', (b) => err.push(b));
    ps.on('error', (e) => resolve({ ok: false, stderr: e.message }));
    ps.on('exit', (code) => {
      if (code !== 0) { resolve({ ok: false, stderr: Buffer.concat(err).toString('utf8') }); return; }
      try { resolve({ ok: true, result: JSON.parse(Buffer.concat(out).toString('utf8')) }); }
      catch (e) { resolve({ ok: false, stderr: `出力の解析に失敗 - ${e.message}` }); }
    });
  });
}

async function runChildMain() {
  const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
  const { Archipelago, computeArchipelagoDiversity } = await import('../src/sim/index.js');
  const { archipelagoHash } = await import('./state-hash.mjs');
  const steps = +process.argv[3];
  const seed = +process.argv[4];
  const settings = JSON.parse(process.argv[5] ?? '{}');
  await RAPIER.init();
  const arch = new Archipelago(RAPIER, seed, { settings });
  const rows = [];
  let done = 0;
  while (done < steps) {
    const n = Math.min(STAT_INTERVAL, steps - done);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) arch.step();
    const ms = performance.now() - t0;
    done += n;
    const div = computeArchipelagoDiversity(arch.sims);
    rows.push({
      year: (done * CFG.DT) / CFG.YEAR,
      pop: div.living,
      species: div.species,
      effSpecies: div.effSpecies,
      effDiet: div.effDiet,
      speciesFertile: div.speciesFertile,
      effSpeciesFertile: div.effSpeciesFertile,
      msPerStep: ms / n,
    });
  }
  process.stdout.write(JSON.stringify({
    seed,
    steps,
    hash: archipelagoHash(arch),
    migrated: arch.migrated,
    dropped: arch.dropped,
    rows,
  }));
}

if (process.argv[2] === '--child') {
  await runChildMain();
} else {
  const argv = process.argv.slice(2);
  const oi = argv.indexOf('--out');
  let out = null;
  if (oi >= 0) { out = argv[oi + 1]; argv.splice(oi, 2); }
  const { args, settings } = extractSettings(argv);
  const steps = +(args[0] ?? 27000);
  const seeds = (args[1] ?? '1,2,3').split(',').map(Number).filter(Number.isFinite);

  const outcomes = await Promise.all(seeds.map((seed) => runChild(steps, seed, settings)));
  const results = [];
  outcomes.forEach((o, i) => {
    if (o.ok) { o.result.summary = summarize(o.result.rows, steps); results.push(o.result); }
    else {
      console.error(`seed ${seeds[i]}: 子プロセスが失敗しました\n${o.stderr}`);
      process.exitCode = 1;
    }
  });

  if (results.length > 0) {
    for (const r of results) {
      const s = r.summary;
      console.log(`seed ${r.seed}：ハッシュ ${r.hash}・移住 ${r.migrated}（捨て ${r.dropped}）・個体数 ${fmt1(s.pop)}・実効種数 ${fmt2(s.effSpecies)}・交配で束ねた実効種数 ${fmt2(s.effSpeciesFertile)}・${fmt2(s.msPerStep)} ms/ステップ`);
    }
    const n = results.length;
    const avg = (fn) => results.reduce((a, r) => a + fn(r.summary), 0) / n;
    console.log(`平均：個体数 ${fmt1(avg((s) => s.pop))}・実効種数 ${fmt2(avg((s) => s.effSpecies))}・交配で束ねた実効種数 ${fmt2(avg((s) => s.effSpeciesFertile))}・${fmt2(avg((s) => s.msPerStep))} ms/ステップ`);
  }

  if (out) {
    const payload = {
      date: new Date().toISOString(),
      steps,
      seeds,
      settings: normalizeSettings(settings),
      runs: results,
    };
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(payload, null, 2));
  }
}
