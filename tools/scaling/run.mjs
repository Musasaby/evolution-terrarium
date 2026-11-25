// スケーリング検証の実行スクリプト（V0 用）
//   node tools/scaling/run.mjs --variant <名> [--steps 27000] [--seeds 1,2,3] [--settings <値>] [--out <path>]
//
// シードごとに自分自身を子プロセスで起動して並行に走らせ、結果を 1 つの JSON にまとめる。
// --settings は tools/settings-arg.mjs と同じ解釈（テンプレート ID か JSON）。
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSettings } from '../settings-arg.mjs';
import { getVariant } from './variants.mjs';
import { summarizeRun, formatTable } from './summarize.mjs';

const self = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--variant') out.variant = argv[++i];
    else if (a === '--steps') out.steps = argv[++i];
    else if (a === '--seeds') out.seeds = argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  return out;
}

function runWorker(variant, steps, seed, settingsText) {
  return new Promise((resolve, reject) => {
    const ps = spawn(process.execPath, [
      self,
      '--worker', variant, String(steps), String(seed),
      ...(settingsText ? ['--settings', settingsText] : []),
    ], {
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

const { args, settings, text: settingsText } = extractSettings(process.argv.slice(2));
const wi = args.indexOf('--worker');
if (wi >= 0) {
  // 子プロセス：1 シードだけ進めて JSON を stdout に出す
  const name = args[wi + 1];
  const steps = +args[wi + 2];
  const seed = +args[wi + 3];
  const variant = getVariant(name);
  const { runSeed } = await import('../diversity-worker.mjs');
  const result = await runSeed(steps, seed, settings, {
    prepare: variant.prepare,
    sample: variant.sample,
    profile: true,
  });
  process.stdout.write(JSON.stringify(result));
} else {
  const opts = parseArgs(args);
  let variant;
  try {
    if (!opts.variant) throw new Error('--variant を指定してください');
    variant = getVariant(opts.variant);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const steps = +(opts.steps ?? 27000);
  const seeds = (opts.seeds ?? '1,2,3').split(',').map(Number).filter(Number.isFinite);
  const results = await Promise.all(seeds.map((seed) => runWorker(opts.variant, steps, seed, settingsText)));

  const run = {
    variant: opts.variant,
    desc: variant.desc,
    steps,
    seeds,
    settingsText: settingsText ?? null,
    date: new Date().toISOString(),
    results,
  };
  run.summary = summarizeRun(run);

  if (opts.out) {
    await mkdir(dirname(opts.out), { recursive: true });
    await writeFile(opts.out, JSON.stringify(run, null, 2));
  }

  if (settingsText) console.log(`世界の設定: ${settingsText}`);
  console.log(`${opts.variant}（${variant.desc}）／ ${steps} ステップ・シード ${seeds.join(',')}`);
  console.log(formatTable([run]));
}
