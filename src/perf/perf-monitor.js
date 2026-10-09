// ===== パフォーマンス計測 =====
// フレーム間隔・各処理の時間・任意のカウンタを集め、一定間隔でまとめた「スナップショット」を購読者へ配る。
// シミュレーションや描画の中身は知らない。外部の情報（描画統計・物体数など）は addSource() で差し込む。

const now = () => performance.now();

export class PerfMonitor {
  constructor({ interval = 500, history = 180 } = {}) {
    this.interval = interval;
    this.frames = new Float32Array(history);  // 直近のフレーム間隔（ms）。リングバッファ
    this.frameHead = 0; this.frameFilled = 0;
    this.sources = new Map();
    this.subs = new Set();
    this.resetWindow(now());
    this.prevFrame = 0;
    this.frameStart = 0;
  }

  resetWindow(t) {
    this.windowStart = t;
    this.nFrames = 0;
    this.sumInterval = 0; this.maxInterval = 0;
    this.sumWork = 0; this.maxWork = 0;
    this.tasks = new Map();     // name -> 合計 ms
    this.counters = new Map();  // name -> 合計値
  }

  // 外部の情報源を登録する。スナップショットのたびに fn() が呼ばれる
  addSource(name, fn) { this.sources.set(name, fn); return this; }
  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }

  beginFrame(t) {
    if (this.prevFrame) {
      const dt = t - this.prevFrame;
      this.sumInterval += dt; this.maxInterval = Math.max(this.maxInterval, dt);
      this.frames[this.frameHead] = dt;
      this.frameHead = (this.frameHead + 1) % this.frames.length;
      this.frameFilled = Math.min(this.frames.length, this.frameFilled + 1);
      this.nFrames++;
    }
    this.prevFrame = t;
    this.frameStart = now();
  }

  // 処理 fn にかかった時間を name ごとに合計する
  time(name, fn) {
    const t0 = now();
    try { return fn(); } finally { this.tasks.set(name, (this.tasks.get(name) || 0) + now() - t0); }
  }
  // 任意の量を合計する（ステップ数など）
  add(name, v) { this.counters.set(name, (this.counters.get(name) || 0) + v); }

  endFrame(t) {
    const work = t - this.frameStart;
    this.sumWork += work; this.maxWork = Math.max(this.maxWork, work);
    if (t - this.windowStart >= this.interval && this.nFrames > 0) this.publish(t);
  }

  // 直近のフレーム間隔を古い順に返す
  frameHistory() {
    const n = this.frameFilled, out = new Float32Array(n), len = this.frames.length;
    for (let i = 0; i < n; i++) out[i] = this.frames[(this.frameHead - n + i + len) % len];
    return out;
  }

  publish(t) {
    const secs = (t - this.windowStart) / 1000, n = this.nFrames;
    const tasks = {}, counters = {}, sources = {};
    for (const [k, v] of this.tasks) tasks[k] = v / n;
    for (const [k, v] of this.counters) counters[k] = v;
    for (const [k, fn] of this.sources) { try { sources[k] = fn(); } catch { sources[k] = null; } }
    const snap = {
      seconds: secs, frames: n,
      fps: n / secs,
      frameMs: this.sumInterval / n, frameMaxMs: this.maxInterval,
      workMs: this.sumWork / n, workMaxMs: this.maxWork,
      tasks,       // 処理ごとの1フレームあたり平均 ms
      counters,    // 期間中の合計
      sources,
      history: this.frameHistory(),
    };
    this.last = snap;
    this.resetWindow(t);
    for (const fn of this.subs) fn(snap);
  }
}

// 体感の目安：フレームレートと、指定した速度に追いつけているか
export function healthOf({ fps, realtimeRatio }) {
  const lagging = realtimeRatio !== null && realtimeRatio < 0.9;
  if (fps < 24 || (realtimeRatio !== null && realtimeRatio < 0.6)) return { level: 'bad', label: '重い' };
  if (fps < 50 || lagging) return { level: 'warn', label: 'やや重い' };
  return { level: 'ok', label: '良好' };
}
