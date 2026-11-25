// ===== 描画の上限を測る計測ページ（個体数別） =====
// URL パラメータ: counts（既定 200,500,1000,2000）・frames（既定 300）・warm（既定 60）・seed（既定 1）
//
// 同じ sim から生きている個体を雛形として取り、個体数 N 体ぶんの写しを sim.creatures に入れて
// view.update() と view.render() の所要時間・フレーム間隔を測る。シミュレーションは進めない。
import RAPIER from 'rapier';
import { Sim, CFG, makeRng } from '../../src/sim/index.js';
import { WorldView } from '../../src/render/world-view.js';

const params = new URLSearchParams(location.search);

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function list(v, fallback) {
  if (!v) return fallback;
  const a = v.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0);
  return a.length ? a : fallback;
}

const counts = list(params.get('counts'), [200, 500, 1000, 2000]);
const frames = Math.max(1, Math.floor(num(params.get('frames'), 300)));
const warm = Math.max(0, Math.floor(num(params.get('warm'), 60)));
const seed = num(params.get('seed'), 1);

const el = {
  view: document.getElementById('view'),
  status: document.getElementById('status'),
  out: document.getElementById('out'),
  json: document.getElementById('json'),
};

// 中央値と 90 パーセンタイル
function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function median(sorted) { return quantile(sorted, 0.5); }
function p90(sorted) { return quantile(sorted, 0.9); }

function gpuName(canvas) {
  try {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return 'unknown';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : String(gl.getParameter(gl.RENDERER));
  } catch {
    return 'unknown';
  }
}

// 雛形（生きている個体）を順に使い回して N 体ぶんの写しを作る
function fillCreatures(sim, templates, n, rng) {
  const edge = sim.edge;
  const out = new Array(n);
  for (let c = 0; c < n; c++) {
    const base = templates[c % templates.length];
    const pos = new Array(base.pos.length);
    for (let i = 0; i < base.pos.length; i++) {
      const p = base.pos[i];
      pos[i] = { x: p.x + rng.range(-edge, edge), y: p.y, z: p.z + rng.range(-edge, edge) };
    }
    out[c] = {
      alive: true,
      dead: false,
      genome: base.genome,
      species: base.species,
      bodies: base.bodies,
      pos,
      rot: base.rot,
    };
  }
  sim.creatures = out;
}

// warm フレームを捨てて frames フレームを測る
function measure(view, sim) {
  return new Promise((resolve) => {
    const samples = [];
    let prev = performance.now();
    let i = 0;
    const total = warm + frames;

    function tick() {
      const now = performance.now();
      const interval = now - prev;
      prev = now;

      // 行列の更新を起こすため、位置をわずかに動かす
      for (let k = 0; k < sim.creatures.length; k++) {
        const cr = sim.creatures[k];
        for (let j = 0; j < cr.pos.length; j++) cr.pos[j].x += Math.sin(now / 500 + k) * 0.001;
      }

      const t0 = performance.now();
      view.update(1 / 60, now, { selected: null, follow: false });
      const t1 = performance.now();
      view.render();
      const t2 = performance.now();

      i++;
      if (i > warm) samples.push({ update: t1 - t0, render: t2 - t1, interval: i > 1 ? interval : NaN });

      if (i < total) requestAnimationFrame(tick);
      else resolve(samples);
    }

    requestAnimationFrame(tick);
  });
}

function summarize(samples, count, info, gpu) {
  const update = samples.map(s => s.update).sort((a, b) => a - b);
  const render = samples.map(s => s.render).sort((a, b) => a - b);
  const interval = samples.map(s => s.interval).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    count,
    updateMs: { median: median(update), p90: p90(update) },
    renderMs: { median: median(render), p90: p90(render) },
    intervalMs: { median: median(interval), p90: p90(interval) },
    calls: info.calls,
    triangles: info.triangles,
    gpu,
  };
}

function fmt(v) { return Number.isFinite(v) ? v.toFixed(3) : '-'; }

function renderTable(results) {
  const head = '個体数 | update median/p90 (ms) | render median/p90 (ms) | 間隔 median/p90 (ms) | calls | triangles';
  const lines = [head, '-'.repeat(head.length)];
  for (const r of results) {
    lines.push([
      String(r.count).padStart(6),
      `${fmt(r.updateMs.median)} / ${fmt(r.updateMs.p90)}`.padStart(22),
      `${fmt(r.renderMs.median)} / ${fmt(r.renderMs.p90)}`.padStart(22),
      `${fmt(r.intervalMs.median)} / ${fmt(r.intervalMs.p90)}`.padStart(20),
      String(r.calls).padStart(5),
      String(r.triangles).padStart(9),
    ].join(' | '));
  }
  return lines.join('\n');
}

async function main() {
  el.status.textContent = '物理エンジンを読み込んでいます…';
  await RAPIER.init();

  el.status.textContent = '世界を生成しています…';
  const sim = new Sim(RAPIER, seed);   // 進めない（初期状態の生きている個体を雛形にする）

  const templates = sim.creatures.filter(c => c.alive);
  if (!templates.length) throw new Error('雛形にできる生きている個体がいません');

  const maxCount = Math.max(...counts);
  const view = new WorldView(el.view, { markerColor: '#ffcc00', maxParts: maxCount * CFG.MAXP });
  view.attach(sim);
  const gpu = gpuName(view.canvas);

  const results = [];
  for (const n of counts) {
    el.status.textContent = `計測中: ${n} 体（warm ${warm} + frames ${frames}）…`;
    const rng = makeRng(seed);
    fillCreatures(sim, templates, n, rng);
    const samples = await measure(view, sim);
    const info = view.renderInfo();
    results.push(summarize(samples, n, info, gpu));
  }

  el.status.textContent = `完了（GPU: ${gpu}）`;
  el.out.textContent = renderTable(results);
  el.json.value = JSON.stringify({ counts, frames, warm, seed, gpu, results }, null, 2);
}

main().catch((err) => {
  el.status.textContent = '失敗: ' + err.message;
  console.error(err);
});
