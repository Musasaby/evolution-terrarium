// ===== 毎フレームの処理の順番 =====
// ループ自体は「何を」更新するかを知らない。登録された処理を順に呼び、かかった時間を計測器へ渡すだけ。

export class GameLoop {
  // perf: PerfMonitor（beginFrame / time / endFrame を持つもの）
  constructor(perf) {
    this.perf = perf;
    this.tasks = [];       // { name, fn(dtr, now) }
    this.lastT = 0;
    this.running = false;
  }
  // 毎フレーム呼ぶ処理を追加する。name は計測表示に使われる
  add(name, fn) { this.tasks.push({ name, fn }); return this; }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    const frame = (now) => {
      if (!this.running) return;
      const dtr = Math.min(0.1, (now - this.lastT) / 1000);
      this.lastT = now;
      this.perf.beginFrame(now);
      for (const t of this.tasks) this.perf.time(t.name, () => t.fn(dtr, now));
      this.perf.endFrame(performance.now());
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  stop() { this.running = false; }
}
