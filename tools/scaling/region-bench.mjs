import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { takeSnapshot } from './region-snapshot.mjs';

const workerUrl = new URL('./region-worker.mjs', import.meta.url);

const BOX_BYTES = 2 ** 20;
const BOX_SIZE = 4 + BOX_BYTES;
const STOP_GENERATION = -1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function writeBox(sab, value) {
  const bytes = encoder.encode(JSON.stringify(value));
  if (bytes.length > BOX_BYTES) throw new Error(`共有箱があふれました: ${bytes.length} > ${BOX_BYTES}`);
  new Uint8Array(sab, 4, bytes.length).set(bytes);
  Atomics.store(new Int32Array(sab, 0, 1), 0, bytes.length);
}

function readBox(sab) {
  const len = Atomics.load(new Int32Array(sab, 0, 1), 0);
  const bytes = new Uint8Array(sab, 4, len).slice();
  return JSON.parse(decoder.decode(bytes));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--regions') out.regions = argv[++i];
    else if (a === '--sizes') out.sizes = argv[++i];
    else if (a === '--steps') out.steps = argv[++i];
    else if (a === '--warm') out.warm = argv[++i];
    else if (a === '--seed') out.seed = argv[++i];
    else if (a === '--sync') out.sync = argv[++i];
    else if (a === '--repeat') out.repeat = argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  return out;
}

function regionLayout(n) {
  const INF = Infinity;
  if (n === 1) {
    return {
      bounds: [{ x0: -INF, x1: INF, z0: -INF, z1: INF }],
      assign: () => 0,
    };
  }
  if (n === 2) {
    return {
      bounds: [
        { x0: -INF, x1: 0, z0: -INF, z1: INF },
        { x0: 0, x1: INF, z0: -INF, z1: INF },
      ],
      assign: (x) => (x < 0 ? 0 : 1),
    };
  }
  if (n === 4) {
    return {
      bounds: [
        { x0: -INF, x1: 0, z0: -INF, z1: 0 },
        { x0: 0, x1: INF, z0: -INF, z1: 0 },
        { x0: -INF, x1: 0, z0: 0, z1: INF },
        { x0: 0, x1: INF, z0: 0, z1: INF },
      ],
      assign: (x, z) => (z < 0 ? 0 : 2) + (x < 0 ? 0 : 1),
    };
  }
  throw new Error(`未対応の区画数: ${n}`);
}

function spawnWorker(data) {
  return new Promise((resolve, reject) => {
    const w = new Worker(workerUrl, { workerData: data });
    let ready = false;
    const onMessage = (m) => {
      if (m && m.type === 'ready') {
        ready = true;
        cleanup();
        resolve(w);
      }
    };
    const onError = (e) => {
      if (!ready) {
        cleanup();
        reject(e);
      }
    };
    const onExit = (code) => {
      if (!ready) {
        cleanup();
        reject(new Error(`区画 ${data.index} の worker が起動前に終了 (${code})`));
      }
    };
    function cleanup() {
      w.off('message', onMessage);
      w.off('error', onError);
      w.off('exit', onExit);
    }
    w.on('message', onMessage);
    w.on('error', onError);
    w.on('exit', onExit);
  });
}

function request(w, msg) {
  return new Promise((resolve, reject) => {
    const onMessage = (m) => {
      if (m && (m.type === 'done' || m.type === 'hash')) {
        cleanup();
        resolve(m);
      }
    };
    const onError = (e) => {
      cleanup();
      reject(e);
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`worker が終了 (${code})`));
    };
    function cleanup() {
      w.off('message', onMessage);
      w.off('error', onError);
      w.off('exit', onExit);
    }
    w.on('message', onMessage);
    w.on('error', onError);
    w.on('exit', onExit);
    w.postMessage(msg);
  });
}

const round4 = (v) => Math.round(v * 1e4) / 1e4;

async function runRegionSet(snap, regionCount, steps, sync) {
  const { bounds, assign } = regionLayout(regionCount);
  const groups = bounds.map(() => []);
  for (const e of snap.creatures) {
    const p = e.bodies[0].p;
    groups[assign(p.x, p.z)].push(e);
  }
  const countsStart = groups.map((g) => g.length);

  const workers = [];
  for (let i = 0; i < regionCount; i++) {
    workers.push(await spawnWorker({ index: i, bounds: bounds[i], size: snap.size, grid: snap.grid, H: snap.H }));
  }

  let pending = groups;
  const prevHandover = new Array(regionCount).fill(0);
  let totalHandoverMs = 0;
  let totalHandovers = 0;
  let sumMax = 0;
  let sumMean = 0;
  let lastDone = null;

  const t0 = performance.now();
  for (let s = 0; s < steps; s++) {
    const responses = await Promise.all(workers.map((w, i) => request(w, { type: 'step', immigrants: pending[i] })));
    const next = bounds.map(() => []);
    let maxC = 0;
    let sumC = 0;
    for (let i = 0; i < regionCount; i++) {
      const r = responses[i];
      maxC = Math.max(maxC, r.computeMs);
      sumC += r.computeMs;
      totalHandoverMs += r.handoverMs - prevHandover[i];
      prevHandover[i] = r.handoverMs;
      totalHandovers += r.emigrants.length;
      for (const e of r.emigrants) {
        const p = e.bodies[0].p;
        next[assign(p.x, p.z)].push(e);
      }
    }
    sumMax += maxC;
    sumMean += sumC / regionCount;
    pending = next;
    lastDone = responses;
  }
  const wallMs = performance.now() - t0;
  const countsEnd = lastDone
    ? lastDone.map((r, i) => r.count + pending[i].length)
    : countsStart.slice();

  const hashResponses = await Promise.all(workers.map((w) => request(w, { type: 'hash' })));
  const entries = [];
  for (const r of hashResponses) for (const e of r.entries) entries.push(e);
  for (const arr of pending) {
    for (const e of arr) {
      const p = e.bodies[0].p;
      entries.push([e.id, round4(p.x), round4(p.y), round4(p.z)]);
    }
  }
  entries.sort((a, b) => a[0] - b[0]);
  const hash = createHash('sha1').update(JSON.stringify(entries)).digest('hex').slice(0, 16);

  for (const w of workers) await w.terminate();

  const msPerStep = wallMs / steps;
  const computeMaxMs = sumMax / steps;
  const computeMeanMs = sumMean / steps;
  return {
    size: snap.size,
    regions: regionCount,
    sync,
    steps,
    msPerStep,
    computeMaxMs,
    computeMeanMs,
    syncMs: msPerStep - computeMaxMs,
    imbalance: computeMeanMs > 0 ? computeMaxMs / computeMeanMs : 0,
    handoversPer1000: (totalHandovers / steps) * 1000,
    handoverMsPerCreature: totalHandovers > 0 ? totalHandoverMs / totalHandovers : 0,
    countsStart,
    countsEnd,
    hash,
  };
}

async function runRegionSetAtomics(snap, regionCount, steps) {
  const { bounds, assign } = regionLayout(regionCount);
  const groups = bounds.map(() => []);
  for (const e of snap.creatures) {
    const p = e.bodies[0].p;
    groups[assign(p.x, p.z)].push(e);
  }
  const countsStart = groups.map((g) => g.length);

  const ctrl = new Int32Array(new SharedArrayBuffer(8));
  const inboxes = bounds.map(() => new SharedArrayBuffer(BOX_SIZE));
  const outboxes = bounds.map(() => new SharedArrayBuffer(BOX_SIZE));

  const workers = [];
  for (let i = 0; i < regionCount; i++) {
    workers.push(
      await spawnWorker({
        index: i,
        bounds: bounds[i],
        size: snap.size,
        grid: snap.grid,
        H: snap.H,
        atomics: { ctrl, inbox: inboxes[i], outbox: outboxes[i] },
      }),
    );
  }

  let pending = groups;
  const prevHandover = new Array(regionCount).fill(0);
  let totalHandoverMs = 0;
  let totalHandovers = 0;
  let sumMax = 0;
  let sumMean = 0;
  let lastDone = null;

  const t0 = performance.now();
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < regionCount; i++) writeBox(inboxes[i], pending[i]);
    Atomics.store(ctrl, 1, 0);
    Atomics.add(ctrl, 0, 1);
    Atomics.notify(ctrl, 0);
    for (;;) {
      const done = Atomics.load(ctrl, 1);
      if (done >= regionCount) break;
      Atomics.wait(ctrl, 1, done);
    }

    const responses = outboxes.map((box) => readBox(box));
    const next = bounds.map(() => []);
    let maxC = 0;
    let sumC = 0;
    for (let i = 0; i < regionCount; i++) {
      const r = responses[i];
      maxC = Math.max(maxC, r.computeMs);
      sumC += r.computeMs;
      totalHandoverMs += r.handoverMs - prevHandover[i];
      prevHandover[i] = r.handoverMs;
      totalHandovers += r.emigrants.length;
      for (const e of r.emigrants) {
        const p = e.bodies[0].p;
        next[assign(p.x, p.z)].push(e);
      }
    }
    sumMax += maxC;
    sumMean += sumC / regionCount;
    pending = next;
    lastDone = responses;
  }
  const wallMs = performance.now() - t0;

  Atomics.store(ctrl, 0, STOP_GENERATION);
  Atomics.notify(ctrl, 0);

  const countsEnd = lastDone
    ? lastDone.map((r, i) => r.count + pending[i].length)
    : countsStart.slice();

  const hashResponses = await Promise.all(workers.map((w) => request(w, { type: 'hash' })));
  const entries = [];
  for (const r of hashResponses) for (const e of r.entries) entries.push(e);
  for (const arr of pending) {
    for (const e of arr) {
      const p = e.bodies[0].p;
      entries.push([e.id, round4(p.x), round4(p.y), round4(p.z)]);
    }
  }
  entries.sort((a, b) => a[0] - b[0]);
  const hash = createHash('sha1').update(JSON.stringify(entries)).digest('hex').slice(0, 16);

  for (const w of workers) await w.terminate();

  const msPerStep = wallMs / steps;
  const computeMaxMs = sumMax / steps;
  const computeMeanMs = sumMean / steps;
  return {
    size: snap.size,
    regions: regionCount,
    sync: 'atomics',
    steps,
    msPerStep,
    computeMaxMs,
    computeMeanMs,
    syncMs: msPerStep - computeMaxMs,
    imbalance: computeMeanMs > 0 ? computeMaxMs / computeMeanMs : 0,
    handoversPer1000: (totalHandovers / steps) * 1000,
    handoverMsPerCreature: totalHandovers > 0 ? totalHandoverMs / totalHandovers : 0,
    countsStart,
    countsEnd,
    hash,
  };
}

function fmt(v, d = 2) {
  return Number.isFinite(v) ? v.toFixed(d) : String(v);
}

function fmtCounts(counts) {
  if (!Array.isArray(counts)) return String(counts);
  const total = counts.reduce((a, n) => a + n, 0);
  return `${counts.join('/')} (${total})`;
}

function printTable(runs) {
  const head = ['size', 'regions', 'msPerStep', 'computeMaxMs', 'computeMeanMs', 'syncMs', 'imbalance', 'handoversPer1000', 'handoverMsPerCreature', 'countsStart', 'countsEnd', 'hash', 'hashMatch'];
  const w = [6, 7, 10, 13, 14, 8, 9, 15, 20, 16, 16, 18, 9];
  console.log(head.map((h, i) => h.padEnd(w[i])).join(' '));
  for (const r of runs) {
    const cells = [
      r.size, r.regions, fmt(r.msPerStep), fmt(r.computeMaxMs), fmt(r.computeMeanMs), fmt(r.syncMs),
      fmt(r.imbalance), fmt(r.handoversPer1000), fmt(r.handoverMsPerCreature, 4),
      fmtCounts(r.countsStart), fmtCounts(r.countsEnd), r.hash, r.hashMatch,
    ];
    console.log(cells.map((c, i) => String(c).padEnd(w[i])).join(' '));
  }
}

const opts = parseArgs(process.argv.slice(2));
const regionsList = (opts.regions ?? '1,2,4').split(',').map(Number).filter(Number.isFinite);
const sizes = (opts.sizes ?? '120').split(',').map(Number).filter(Number.isFinite);
const steps = +(opts.steps ?? 900);
const warm = +(opts.warm ?? 900);
const seed = +(opts.seed ?? 1);
const syncs = (opts.sync ?? 'message').split(',').map((s) => s.trim()).filter(Boolean);
const repeat = Math.max(1, Math.floor(+(opts.repeat ?? 1)));
for (const sync of syncs) {
  if (sync !== 'message' && sync !== 'atomics') throw new Error(`未対応の同期方法: ${sync}`);
}

const runs = [];
for (const size of sizes) {
  const snap = await takeSnapshot({ seed, size, warm });
  for (const regions of regionsList) {
    for (const sync of syncs) {
      let firstHash = null;
      for (let r = 0; r < repeat; r++) {
        const result =
          sync === 'atomics'
            ? await runRegionSetAtomics(snap, regions, steps)
            : await runRegionSet(snap, regions, steps, 'message');
        if (firstHash === null) firstHash = result.hash;
        result.hashMatch = result.hash === firstHash;
        result.repeat = r + 1;
        runs.push(result);
      }
    }
  }
}

printTable(runs);

if (opts.out) {
  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify({ date: new Date().toISOString(), seed, warm, runs }, null, 2));
}
