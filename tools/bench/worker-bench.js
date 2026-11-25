// ===== sim を主スレッドと Worker で動かしたときの差を測る計測ページ =====
// URL パラメータ: modes（既定 main,worker）・speeds（既定 1,8）・secs（既定 20）・seed（既定 1）
//
// 描画は modes/speeds によらず同じ（地面 1 枚＋体節の球インスタンス）。3 秒捨ててから secs 秒測る。
import * as THREE from 'three';
import RAPIER from 'rapier';
import { Sim } from '../../src/sim/index.js';
import { SimRunner } from '../../src/app/sim-runner.js';
import { packPoses } from './pack-poses.js';

const MAX_INSTANCES = 8000;
const WARM_MS = 3000;
const WORKER_TIMEOUT_MS = 30000;

const params = new URLSearchParams(location.search);

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function csv(v) {
  return (v || '').split(',').map(s => s.trim()).filter(Boolean);
}

const modes = csv(params.get('modes')).filter(m => m === 'main' || m === 'worker');
if (!modes.length) modes.push('main', 'worker');
const speeds = (csv(params.get('speeds')).map(Number).filter(n => Number.isFinite(n) && n >= 0));
const speedList = speeds.length ? speeds : [1, 8];
const secs = Math.max(0.5, num(params.get('secs'), 20));
const seed = num(params.get('seed'), 1);

const el = {
  view: document.getElementById('view'),
  status: document.getElementById('status'),
  out: document.getElementById('out'),
  json: document.getElementById('json'),
};

// ---------- 描画 ----------
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
el.view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101418);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 28, 48);
camera.lookAt(0, 4, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(20, 40, 20);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0x2a323a, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const sphere = new THREE.SphereGeometry(1, 10, 6);
const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05 });
const mesh = new THREE.InstancedMesh(sphere, mat, MAX_INSTANCES);
mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
mesh.frustumCulled = false;
mesh.count = 0;
scene.add(mesh);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const m4 = new THREE.Matrix4();
const p = new THREE.Vector3();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const color = new THREE.Color();

function drawPoses(buf, n) {
  const count = Math.min(n, MAX_INSTANCES);
  for (let i = 0; i < count; i++) {
    const o = i * 9;
    p.set(buf[o], buf[o + 1], buf[o + 2]);
    q.set(buf[o + 3], buf[o + 4], buf[o + 5], buf[o + 6]);
    s.setScalar(buf[o + 7]);
    m4.compose(p, q, s);
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, color.setHSL(buf[o + 8], 0.6, 0.5));
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function clearPoses() {
  mesh.count = 0;
  renderer.render(scene, camera);
}

// ---------- 集計 ----------
function quantile(values, qv) {
  if (!values.length) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const pos = (sorted.length - 1) * qv;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function median(values) { return quantile(values, 0.5); }

// ---------- 1 条件の計測 ----------
async function runOne(mode, speed) {
  const warmMs = WARM_MS;
  const measureMs = secs * 1000;
  const startedAt = performance.now();

  let sim = null, runner = null, worker = null;
  let error = null;
  let latestBuf = null, latestN = 0;
  let firstDataAt = 0, warmEnd = 0, endAt = Infinity;
  let measuring = false, measureStart = 0, lastFrame = 0;
  let frames = 0;
  const intervals = [];
  let simSeconds = 0;
  let transferBytes = 0, transfers = 0;
  const delays = [];

  if (mode === 'main') {
    sim = new Sim(RAPIER, seed);
    runner = new SimRunner();
  } else {
    worker = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'poses') {
        const receivedAt = performance.timeOrigin + performance.now();
        latestBuf = m.buf;
        latestN = m.n;
        if (measuring) {
          transfers++;
          transferBytes += m.buf.byteLength;
          delays.push(receivedAt - m.sentAt);
          simSeconds += m.simSeconds;
        }
      } else if (m.type === 'error') {
        error = m.message;
      }
    };
    worker.onerror = (e) => { error = e.message || 'worker error'; };
    worker.postMessage({ type: 'init', seed, speed });
  }

  let prev = performance.now();
  while (true) {
    await new Promise(r => requestAnimationFrame(r));
    const now = performance.now();
    const dt = (now - prev) / 1000;
    prev = now;

    if (mode === 'main') {
      const r = runner.advance(sim, dt, speed);
      if (measuring) simSeconds += r.simSeconds;
      const packed = packPoses(sim);
      latestBuf = packed.buf;
      latestN = packed.n;
    }

    if (latestBuf && latestN > 0) drawPoses(latestBuf, latestN);
    else clearPoses();
    renderer.render(scene, camera);

    if (error) break;

    if (!firstDataAt) {
      if (latestBuf) {
        firstDataAt = now;
        warmEnd = now + warmMs;
        endAt = warmEnd + measureMs;
      } else if (mode === 'worker' && now - startedAt > WORKER_TIMEOUT_MS) {
        error = 'worker から poses が届きません';
        break;
      }
      continue;
    }

    if (!measuring) {
      if (now >= warmEnd) {
        measuring = true;
        measureStart = now;
        lastFrame = now;
      }
      continue;
    }

    frames++;
    intervals.push(now - lastFrame);
    lastFrame = now;
    if (now >= endAt) break;
  }

  if (worker) worker.terminate();

  const elapsed = measureStart ? (performance.now() - measureStart) / 1000 : 0;
  const result = {
    mode,
    speed,
    fps: elapsed > 0 ? frames / elapsed : 0,
    frameMedianMs: median(intervals),
    frameP90Ms: quantile(intervals, 0.9),
    effectiveSpeed: elapsed > 0 ? simSeconds / elapsed : 0,
    segments: latestN,
    transferBytesAvg: null,
    transfersPerSec: null,
    transferDelayMedianMs: null,
    error,
  };
  if (mode === 'worker' && transfers > 0 && elapsed > 0) {
    result.transferBytesAvg = transferBytes / transfers;
    result.transfersPerSec = transfers / elapsed;
    result.transferDelayMedianMs = median(delays);
  }
  return result;
}

// ---------- 表示 ----------
function fmt(v, digits = 1) {
  return Number.isFinite(v) ? v.toFixed(digits) : '-';
}

function renderResults(results) {
  const head = ['mode', 'speed', 'fps', 'med ms', 'p90 ms', 'eff speed', 'segments', 'KB/転送', '転送/秒', '遅れ med ms'];
  const widths = [7, 6, 8, 8, 8, 10, 9, 9, 9, 12];
  const row = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join(' ');
  const lines = [row(head), widths.map(w => '-'.repeat(w)).join(' ')];
  for (const r of results) {
    lines.push(row([
      r.mode, `x${r.speed}`, fmt(r.fps), fmt(r.frameMedianMs, 2), fmt(r.frameP90Ms, 2),
      fmt(r.effectiveSpeed, 2), r.segments,
      r.transferBytesAvg === null ? '-' : fmt(r.transferBytesAvg / 1024),
      r.transfersPerSec === null ? '-' : fmt(r.transfersPerSec),
      r.transferDelayMedianMs === null ? '-' : fmt(r.transferDelayMedianMs, 2),
    ]));
  }
  el.out.textContent = lines.join('\n');
  el.json.value = JSON.stringify(results, null, 2);
}

// ---------- 実行 ----------
async function main() {
  await RAPIER.init();
  const combos = [];
  for (const mode of modes) for (const speed of speedList) combos.push([mode, speed]);

  const results = [];
  for (let i = 0; i < combos.length; i++) {
    const [mode, speed] = combos[i];
    el.status.textContent = `実行中: ${mode} ×${speed} (${i + 1}/${combos.length})`;
    results.push(await runOne(mode, speed));
    renderResults(results);
  }
  el.status.textContent = '完了';
}

main().catch(err => {
  el.status.textContent = '失敗: ' + (err?.message ?? err);
  console.error(err);
});
