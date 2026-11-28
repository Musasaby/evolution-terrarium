// ===== ブラウザで 1 つの島を動かす module Worker =====
// Worker では import map が効かないため、rapier は index.html の import map と同じ URL を直接読む。
import RAPIER from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/dist/rapier.mjs';
import { IslandHost, runIslandRequest, SectionProfiler, NULL_PROFILER } from '../sim/index.js';
import { packFrame, packPanels, createSentState } from './island-snapshot.js';

const ready = RAPIER.init();
const profiler = new SectionProfiler();
const sent = createSentState();
let host = null;
let chain = Promise.resolve();   // 要求は届いた順に 1 つずつ処理する
self.onmessage = (e) => { chain = chain.then(() => handle(e.data)); };

async function handle(msg) {
  await ready;
  try {
    let result = null, transfer = [];
    if (msg.type === 'init') {
      host = new IslandHost(RAPIER, msg.spec);
      const s = host.sim;
      result = { info: { index: host.index, seed: s.seed, size: s.size, grid: s.grid, settings: s.settings } };
    } else if (msg.type === 'frame') {
      // msg: { panels: bool, selectedId, profile: bool }
      host.sim.profiler = msg.profile ? profiler : NULL_PROFILER;
      const f = packFrame(host.sim, sent);
      transfer = f.transfer;
      result = { frame: f.packet, panels: msg.panels ? packPanels(host.sim, sent, msg.selectedId ?? null, msg.profile ? profiler.take() : null) : null };
    } else if (msg.type === 'forceWeather') { host.sim.forceWeather(msg.weather); result = {}; }
    else if (msg.type === 'log') { host.sim.log(msg.msg, msg.kind); result = {}; }
    else result = runIslandRequest(host, msg);
    if (!result) throw new Error(`知らない要求 ${msg.type}`);
    self.postMessage({ id: msg.id, ...result }, transfer);
  } catch (err) {
    self.postMessage({ id: msg.id, error: String(err?.stack ?? err) });
  }
}
