// 物理の所要時間を交互に測る A/B 計測（V0 用）
//   node tools/scaling/ab-bench.mjs --variants base,groups16 [--steps 1800] [--seed 1] [--rounds 3] [--settings <値>] [--out <path>]
//
// 回ごとに条件の並びを 1 つずつ左に回し、子プロセスを 1 つずつ順に起動して
// 条件ごとの物理 ms/ステップ・全体 ms/ステップの中央値を出す（並行にはしない。負荷が揺れるため）。
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSettings } from '../settings-arg.mjs';
import { getVariant } from './variants.mjs';

const self = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--variants') out.variants = argv[++i];
    else if (a === '--steps') out.steps = argv[++i];
    else if (a === '--seed') out.seed = argv[++i];
    else if (a === '--rounds') out.rounds = argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  return out;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 並びを左に r 個回す。r = 0 ならそのまま。
function rotate(list, r) {
  const k = r % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
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
      if (code !== 0) { reject(new Error(`${variant}: 子プロセスが ${code} で終了`)); return; }
      try { resolve(JSON.parse(Buffer.concat(out).toString('utf8'))); }
      catch (e) { reject(new Error(`${variant}: 出力の解析に失敗 - ${e.message}`)); }
    });
  });
}

const { args, settings, text: settingsText } = extractSettings(process.argv.slice(2));
const wi = args.indexOf('--worker');
if (wi >= 0) {
  // 子プロセス：1 条件だけ進めて JSON を stdout に出す
  const name = args[wi + 1];
  const steps = +args[wi + 2];
  const seed = +args[wi + 3];
  const variant = getVariant(name);
  const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
  const { Sim, SectionProfiler } = await import('../../src/sim/index.js');
  await RAPIER.init();

  const prof = new SectionProfiler();
  const sim = new Sim(RAPIER, seed, { profiler: prof, settings });
  variant.prepare(sim, RAPIER);
  prof.take(); // 世界の生成分を捨てる

  const t0 = performance.now();
  for (let i = 0; i < steps; i++) sim.step();
  const runMs = performance.now() - t0;
  const sections = prof.take();

  const living = sim.creatures.filter((c) => c.alive && !c.dead).length;
  const result = {
    variant: name,
    physMs: (sections['物理']?.ms ?? 0) / steps,
    totalMs: runMs / steps,
    sections,
    living,
  };
  process.stdout.write(JSON.stringify(result));
} else {
  const opts = parseArgs(args);
  const names = (opts.variants ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  try {
    if (names.length === 0) throw new Error('--variants を指定してください');
    for (const name of names) getVariant(name);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const steps = +(opts.steps ?? 1800);
  const seed = +(opts.seed ?? 1);
  const rounds = +(opts.rounds ?? 3);

  const runs = [];
  for (let r = 0; r < rounds; r++) {
    const order = rotate(names, r);
    console.log(`${r + 1} 回目: ${order.join(', ')}`);
    for (const name of order) {
      const result = await runWorker(name, steps, seed, settingsText);
      runs.push({ round: r + 1, ...result });
    }
  }

  const medians = {};
  for (const name of names) {
    const mine = runs.filter((x) => x.variant === name);
    medians[name] = {
      physMs: median(mine.map((x) => x.physMs)),
      totalMs: median(mine.map((x) => x.totalMs)),
    };
  }
  const first = names[0];
  for (const name of names) {
    medians[name].physRatio = medians[name].physMs / medians[first].physMs;
    medians[name].totalRatio = medians[name].totalMs / medians[first].totalMs;
  }

  const run = {
    date: new Date().toISOString(),
    steps,
    seed,
    rounds,
    settingsText: settingsText ?? null,
    runs,
    medians,
  };

  if (opts.out) {
    await mkdir(dirname(opts.out), { recursive: true });
    await writeFile(opts.out, JSON.stringify(run, null, 2));
  }

  if (settingsText) console.log(`世界の設定: ${settingsText}`);
  console.log(`${steps} ステップ・シード ${seed}・${rounds} 回`);
  const HEAD = ['条件', '物理 ms/ステップ', 'base 比', '全体 ms/ステップ', '全体比'];
  const lines = [
    `| ${HEAD.join(' | ')} |`,
    `| ${HEAD.map(() => '---').join(' | ')} |`,
  ];
  for (const name of names) {
    const m = medians[name];
    lines.push(`| ${[
      name,
      m.physMs.toFixed(3),
      m.physRatio.toFixed(3),
      m.totalMs.toFixed(3),
      m.totalRatio.toFixed(3),
    ].join(' | ')} |`);
  }
  console.log(lines.join('\n'));
}
