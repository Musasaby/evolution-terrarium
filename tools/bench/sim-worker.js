// ===== sim を動かす module Worker =====
// Worker では import map が効かないため、rapier は CDN の URL を直接読む。
import RAPIER from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/dist/rapier.mjs';
import { Sim } from '../../src/sim/index.js';
import { SimRunner } from '../../src/app/sim-runner.js';
import { packPoses } from './pack-poses.js';

let sim = null;
let runner = null;
let speed = 1;
let last = 0;
let timer = 0;

function loop() {
  const start = performance.now();
  const dtr = (start - last) / 1000;
  last = start;
  const r = runner.advance(sim, dtr, speed);
  const { buf, n } = packPoses(sim);
  postMessage({
    type: 'poses', buf, n, steps: r.steps, simSeconds: r.simSeconds,
    sentAt: performance.timeOrigin + performance.now(),
  }, [buf.buffer]);
  timer = setTimeout(loop, Math.max(0, 16 - (performance.now() - start)));
}

async function init(seed, sp) {
  await RAPIER.init();
  sim = new Sim(RAPIER, seed);
  runner = new SimRunner();
  speed = sp;
  last = performance.now();
  clearTimeout(timer);
  timer = setTimeout(loop, 16);
}

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'init') {
    init(m.seed ?? 1, m.speed ?? 1).catch(err => postMessage({ type: 'error', message: String(err?.message ?? err) }));
  } else if (m.type === 'speed') {
    speed = m.speed;
  }
};
