// ===== 起動と配線 =====
// 各部品はお互いを直接知らない。ここで組み立て、ストア・ループ・計測器を通してつなぐ。
//
//   sim/      シミュレーション（描画非依存）
//   render/   3D 描画（sim を読むだけ）
//   ui/       パネル・ヘッダー・操作（ストアを読み書きする）
//   perf/     パフォーマンス計測と表示
//   app/      ストア・ループ・この配線
import RAPIER from 'rapier';
import { Sim, SectionProfiler, NULL_PROFILER } from '../sim/index.js';
import { appStore as store } from './store.js';
import { SimRunner, SPEED_MAX } from './sim-runner.js';
import { GameLoop } from './game-loop.js';
import { WorldView } from '../render/world-view.js';
import { PerfMonitor } from '../perf/perf-monitor.js';
import { PerfOverlay } from '../perf/perf-overlay.js';
import { $, themeColors } from '../ui/dom.js';
import { updateHeader, showWorldInfo } from '../ui/header.js';
import { bindControls } from '../ui/controls.js';
import { createTitleScreen } from '../ui/title-screen.js';
import { formFromSettings, parseWorld, randomSeed, serializeWorld, settingsLabel } from '../ui/world-form.js';
import { PanelHost } from '../ui/panels.js';
import { StatsPanel } from '../ui/panels/stats-panel.js';
import { InspectorPanel } from '../ui/panels/inspector-panel.js';
import { TreePanel } from '../ui/panels/tree-panel.js';
import { LogPanel } from '../ui/panels/log-panel.js';

const DEFAULT_SEED = 20261007;
const UI_INTERVAL = 0.5;   // パネルとヘッダーの更新間隔（実時間の秒）
const PERF_PREF_KEY = 'evolution-terrarium:perfOpen';
const PERF_COMPACT_KEY = 'evolution-terrarium:perfCompact';
const WORLD_PREF_KEY = 'evolution-terrarium:world';

// 表示の好みはブラウザに覚えておく（保存できない環境では毎回既定値）
const pref = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 保存できなくても動作には影響しない */ } },
};

const COL = themeColors();
const view = new WorldView($('view'), { markerColor: COL.accent });
const runner = new SimRunner();
const simProfiler = new SectionProfiler();
const perf = new PerfMonitor({ interval: 500 });
const overlay = new PerfOverlay($('perf'), perf, {
  speedMax: SPEED_MAX,
  compact: pref.get(PERF_COMPACT_KEY) !== '0',
  onCompactChange: (c) => pref.set(PERF_COMPACT_KEY, c ? '1' : '0'),
});

const panels = new PanelHost(store)
  .register(new StatsPanel(COL))
  .register(new InspectorPanel(store, COL))
  .register(new TreePanel(COL))
  .register(new LogPanel());

bindControls(store, {
  forceWeather: (w) => { store.get().sim?.forceWeather(w); panels.renderActive(); },
  newWorld: () => openTitle(),
});

// ---------- パフォーマンス計測の情報源 ----------
const MB = 1024 * 1024;
perf
  .addSource('speed', () => store.get().speed)
  .addSource('simSections', () => simProfiler.take())
  .addSource('render', () => view.renderInfo())
  .addSource('world', () => {
    const sim = store.get().sim; if (!sim) return null;
    let creatures = 0, corpses = 0;
    for (const c of sim.creatures) if (c.alive) c.dead ? corpses++ : creatures++;
    return { creatures, corpses, plants: sim.plants.length, ...sim.physicsCounts() };
  })
  .addSource('memory', () => performance.memory ? { used: performance.memory.usedJSHeapSize / MB, limit: performance.memory.jsHeapSizeLimit / MB } : null);

// 表示しているときだけシミュレーション内部の区間計測を有効にする
function applyPerfVisibility({ perfOpen, sim }) {
  overlay.setVisible(perfOpen);
  if (sim) sim.profiler = perfOpen ? simProfiler : NULL_PROFILER;
}
if (pref.get(PERF_PREF_KEY) !== null) store.set({ perfOpen: pref.get(PERF_PREF_KEY) === '1' });
store.subscribe((s, prev) => {
  if (s.perfOpen !== prev.perfOpen) pref.set(PERF_PREF_KEY, s.perfOpen ? '1' : '0'); // 利用者が切り替えたときだけ保存する
  if (s.perfOpen !== prev.perfOpen || s.sim !== prev.sim) applyPerfVisibility(s);
});
store.subscribe((s, prev) => { if (s.speed !== prev.speed) runner.reset(); });

// ---------- クリックで生物を選ぶ ----------
let downAt = null;
view.canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
view.canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || !store.get().sim) return;
  const c = view.pick(e.clientX, e.clientY);
  if (c) store.set({ selected: c, tab: 'p-ind' });
});

// ---------- 毎フレームの処理 ----------
let uiTimer = 0;
function refreshUI() {
  const { sim } = store.get(); if (!sim) return;
  updateHeader(sim);
  panels.renderActive();
}
new GameLoop(perf)
  .add('シム', (dtr) => {
    const { sim, speed } = store.get(); if (!sim) return;
    const r = runner.advance(sim, dtr, speed);
    perf.add('steps', r.steps); perf.add('simSeconds', r.simSeconds); perf.add('dropped', r.dropped);
  })
  .add('描画更新', (dtr, now) => view.update(dtr, now, store.get()))
  .add('UI', (dtr) => { uiTimer += dtr; if (uiTimer > UI_INTERVAL) { uiTimer = 0; refreshUI(); } })
  .add('レンダリング', () => view.render())
  .start();

// ---------- タイトル画面 ----------
// 最後に使った設定（シードも）はブラウザに覚えておく。保存できない環境では既定の設定から始める
const saved = parseWorld(pref.get(WORLD_PREF_KEY));
let lastWorld = saved ?? { seed: DEFAULT_SEED, settings: undefined };
let resumeSpeed = null;   // タイトル画面を開く前の速度（世界を止めている間だけ持つ）
const title = createTitleScreen($('title'), {
  start: (seed, settings) => {
    pref.set(WORLD_PREF_KEY, serializeWorld(seed, settings));
    lastWorld = { seed, settings };
    title.hide();
    restoreSpeed();
    start(seed, settings).catch(failLoading);
  },
  cancel: () => { title.hide(); restoreSpeed(); },
});
function restoreSpeed() {
  if (resumeSpeed !== null) { store.set({ speed: resumeSpeed }); resumeSpeed = null; }
}
// 前回の設定を残したまま、シードだけ決め直して開く。世界があるときは止めて、キャンセルで戻れるようにする
function openTitle() {
  const canCancel = !!store.get().sim;
  if (canCancel && resumeSpeed === null) { resumeSpeed = store.get().speed; store.set({ speed: 0 }); }
  title.show(formFromSettings(lastWorld.settings, randomSeed()), { canCancel });
}

// ---------- 起動 ----------
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
let rapierReady = false;
// 物理エンジンはタイトル画面を見せている間に裏で読み込む
const rapierLoading = RAPIER.init().then(() => { rapierReady = true; });
const failLoading = (err) => { $('loading').hidden = false; $('loading-msg').textContent = '読み込みに失敗しました: ' + err.message; console.error(err); };
const HINT_MS = 8000;
let hintTimer = 0;
async function start(seed, settings) {
  $('loading').hidden = false;
  $('loading-msg').textContent = rapierReady ? '地形と植生をつくっています…' : '物理エンジンを読み込んでいます…';
  await nextFrame();
  if (!rapierReady) { await rapierLoading; $('loading-msg').textContent = '地形と植生をつくり、最初の生物を試走させています…'; await nextFrame(); }
  // 古い世界を止めてから解放する（ループが解放済みの世界を触らないように）
  const old = store.get().sim;
  store.set({ sim: null, selected: null, follow: false });
  old?.dispose();
  const sim = new Sim(RAPIER, seed, { settings, profiler: store.get().perfOpen ? simProfiler : NULL_PROFILER });
  const world = { seed, settings: sim.settings, label: settingsLabel(sim.settings) };
  sim.log(`世界を始めました（シード ${seed} ／ 設定：${world.label}）`);
  window.__sim = sim; // デバッグ用
  view.attach(sim);
  panels.attach(sim);
  runner.reset();
  simProfiler.take();
  showWorldInfo(world);
  store.set({ sim, world });
  $('loading').hidden = true;
  refreshUI();
  if (!hintTimer) hintTimer = setTimeout(() => $('hint').classList.add('gone'), HINT_MS); // 操作ヒントは最初の世界でだけ見せる
}
applyPerfVisibility(store.get());
rapierLoading.catch(failLoading);
title.show(formFromSettings(lastWorld.settings, lastWorld.seed), { canCancel: false });
