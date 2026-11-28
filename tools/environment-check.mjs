// 水・標高・移動の速さ・体節数を測る道具（ブラウザ不要・sim は変えない）
//   npm run check:environment                      … 既定 9000 ステップ・シード 1,2
//   node tools/environment-check.mjs 9000 1,2      … ステップ数とシードを指定（カンマ区切りで複数可）
//   node tools/environment-check.mjs 9000 1 --settings climate:cold  … 世界の設定（テンプレート ID か JSON）を指定
//
// 約 1 シム秒（30 ステップ）ごとに生きている個体の位置を調べ、次を数える。
// ・水中: 根の体節（c.pos[0]）が水域の上にいて、水面 +0.3 m より下にいること
//         （水の判定は sim.isWater(x, z) と sim.climate.water）
// ・入水 / 上陸: 個体が水中でない→水中（入水）、水中→水中でない（上陸）に変わった回数
// ・水中で死亡: 死亡を観測した時点で直前のサンプルが水中だった個体
// ・転落: 死亡の原因（c.cause）が「転落」の個体
// ・標高の帯: 湖面（sim.climate.baseWater）から最高点までの高さの上位 40% の帯
//             帯の下限 = baseWater + 0.6 * (最高点 - baseWater)。個体の足元の地面がこの帯以上なら帯の個体
// ・速さ: 10 秒以上たどれた個体の水平移動距離 / 経過時間。10・50・90 パーセンタイル
// ・水中の時間: 全サンプルのうち水中だった割合。水中に長くいた個体（wetN / n > 0.5）の aqua 平均と全体の aqua 平均
// ・体節数: 最後の時点の生きている個体の nParts の中央値・90 パーセンタイル・最大
// ・植物: 最後の時点の sim.flora.countBySpecies() を PLANT_SPECIES の名前と組にする
//
// diversity-check.mjs と同じく、シードごとに自分を子プロセス（--worker <ステップ数> <シード>）で
// 起動して並行に進め、JSON を親が集めて表示する。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractSettings } from './settings-arg.mjs';

const self = fileURLToPath(import.meta.url);

const SAMPLE = 30; // 調べる間隔（ステップ。約 1 シム秒）

// 連続値（速さなど）は隣り合う値を線形補間する
function pct(xs, q) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// 整数値（体節数など）は補間しない最近順位法。必ず元の値のどれかを返す
function rank(xs, q) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
}

async function runSeed(steps, seed, settings) {
  const { default: RAPIER } = await import('@dimforge/rapier3d-compat');
  const { Sim, PLANT_SPECIES } = await import('../src/sim/index.js');
  await RAPIER.init();
  const sim = new Sim(RAPIER, seed, { settings });
  const base = sim.climate.baseWater;
  let top = -Infinity;
  for (const h of sim.H) top = Math.max(top, h);
  const band = base + 0.6 * (top - base); // 標高の上位 40% の帯の下限
  const st = new Map(); // 個体 id → { wet, x, z, dist, t0, t1, wetN, n, aqua, done }
  let entries = 0, exits = 0, wetDeaths = 0, falls = 0;
  let maxGround = -Infinity, highSum = 0, highMin = Infinity, samples = 0;
  for (let s = 1; s <= steps; s++) {
    sim.step();
    if (s % SAMPLE) continue;
    const wl = sim.climate.water;
    let high = 0;
    for (const c of sim.creatures) {
      if (!c.alive) continue;
      const p = c.pos[0], e = st.get(c.id);
      if (c.dead) {
        if (e && !e.done) { e.done = true; if (e.wet) wetDeaths++; if (c.cause === '転落') falls++; }
        continue;
      }
      const wet = sim.isWater(p.x, p.z) && p.y < wl + 0.3; // 水域の上にいて、根の体節が水面 +0.3 m より下
      const g = sim.heightAt(p.x, p.z);
      if (!e) st.set(c.id, { wet, x: p.x, z: p.z, dist: 0, t0: sim.t, t1: sim.t, wetN: wet ? 1 : 0, n: 1, aqua: c.aqua ?? 0, done: false });
      else {
        if (wet && !e.wet) entries++;
        if (!wet && e.wet) exits++;
        e.dist += Math.hypot(p.x - e.x, p.z - e.z);
        e.x = p.x; e.z = p.z; e.t1 = sim.t; e.wet = wet; e.n++; if (wet) e.wetN++;
      }
      if (g > maxGround) maxGround = g;
      if (g >= band) high++;
    }
    highSum += high; highMin = Math.min(highMin, high); samples++;
  }

  // 速さ: 10 秒以上たどれた個体の dist / (t1 - t0)
  const speeds = [];
  for (const e of st.values()) {
    const dt = e.t1 - e.t0;
    if (dt >= 10) speeds.push(e.dist / dt);
  }

  // 水中の時間: 全サンプルのうち wet の割合。水中に長くいた個体の aqua 平均と全体の aqua 平均
  let wetN = 0, nAll = 0, aquaWetSum = 0, aquaWetN = 0, aquaAllSum = 0, aquaAllN = 0;
  for (const e of st.values()) {
    wetN += e.wetN; nAll += e.n;
    aquaAllSum += e.aqua; aquaAllN++;
    if (e.wetN / e.n > 0.5) { aquaWetSum += e.aqua; aquaWetN++; }
  }

  // 体節数: 最後の時点の生きている個体
  const parts = [];
  for (const c of sim.creatures) if (c.alive && !c.dead) parts.push(c.nParts);

  // 植物: 最後の時点
  const pc = sim.flora.countBySpecies();
  const plants = PLANT_SPECIES.map((sp, i) => ({ name: sp.name, count: pc[i] }));

  return {
    seed, steps, base, top, band,
    entries, exits, wetDeaths, falls,
    maxGround: Number.isFinite(maxGround) ? maxGround : 0,
    highAvg: samples ? highSum / samples : 0,
    highMin: Number.isFinite(highMin) ? highMin : 0,
    speed: { p10: pct(speeds, 0.1), p50: pct(speeds, 0.5), p90: pct(speeds, 0.9) },
    wetFrac: nAll ? wetN / nAll : 0,
    aquaWet: aquaWetN ? aquaWetSum / aquaWetN : 0,
    aquaAll: aquaAllN ? aquaAllSum / aquaAllN : 0,
    parts: { median: rank(parts, 0.5), p90: rank(parts, 0.9), max: parts.length ? Math.max(...parts) : 0, count: parts.length },
    plants,
  };
}

function fmt1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
function fmt2(v) { return (Math.round(v * 100) / 100).toFixed(2); }

function printSeed(r) {
  console.log(`seed ${r.seed} / ${r.steps} ステップ`);
  console.log(`  水: 入水 ${r.entries}・上陸 ${r.exits}・水中で死亡 ${r.wetDeaths}・転落 ${r.falls}`);
  console.log(`  標高: 最高点 ${fmt1(r.top)} m・帯の下限 ${fmt1(r.band)} m・個体がいた最も高い地面 ${fmt1(r.maxGround)} m・帯の個体（1 時点の平均 ${fmt1(r.highAvg)}・最小 ${r.highMin}）`);
  console.log(`  速さ m/秒（10 / 50 / 90 %）: ${fmt2(r.speed.p10)} / ${fmt2(r.speed.p50)} / ${fmt2(r.speed.p90)}`);
  console.log(`  水中の時間 ${fmt1(r.wetFrac * 100)}%・水中に長くいた個体の水棲度 ${fmt2(r.aquaWet)}（全体 ${fmt2(r.aquaAll)}）`);
  console.log(`  体節数（最後の時点）: 中央値 ${r.parts.median}・上位 10% ${r.parts.p90}・最大 ${r.parts.max}`);
  console.log(`  植物（最後の時点）: ${r.plants.map((p) => `${p.name} ${p.count}`).join('・')}`);
}

function printTotal(results) {
  const entries = results.reduce((a, r) => a + r.entries, 0);
  const exits = results.reduce((a, r) => a + r.exits, 0);
  const wetDeaths = results.reduce((a, r) => a + r.wetDeaths, 0);
  const falls = results.reduce((a, r) => a + r.falls, 0);
  const rate = entries ? (exits / entries) * 100 : 0;
  console.log(`合計: 入水 ${entries}・上陸 ${exits}（上陸の割合 ${fmt1(rate)}%）・水中で死亡 ${wetDeaths}・転落 ${falls}`);
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
  process.stdout.write(JSON.stringify(await runSeed(+args[wi + 1], +args[wi + 2], settings)));
} else {
  const steps = +(args[0] ?? 9000);
  const seeds = (args[1] ?? '1,2').split(',').map(Number).filter(Number.isFinite);
  const results = await Promise.all(seeds.map((seed) => runWorker(steps, seed, settingsText)));
  if (settingsText) console.log(`世界の設定: ${settingsText}`);
  for (const r of results) printSeed(r);
  printTotal(results);
}
