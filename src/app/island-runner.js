// ===== ブラウザで群島を進める：島ごとの Worker を起こし、実時間と倍速からフレームごとに進める =====
// 進め方の規則は sim-runner.js の SimRunner と同じ（予算・最大速度・遅れの捨て方）。
// 姿勢は見ている島（view）の Worker からだけ受け取り、mirror に反映する。
import { ParallelArchipelago, createPort, normalizeSettings, CFG } from '../sim/index.js';
import { SimMirror } from './sim-mirror.js';
import { SPEED_MAX } from './sim-runner.js';

const BUDGET_MS = 22, BUDGET_MAX_MS = 30, MAX_BACKLOG = 0.5;
const PANELS_MS = 250;   // パネル用の中身を取り寄せる間隔（実時間）

export class IslandRunner {
  // 島の数だけ Worker を起こして島を作り、見ている島の最初の中身を受け取ってから返す
  static async create(seed, settings, view = 0) {
    const count = normalizeSettings(settings).islands;
    const workers = [], ports = [];
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./island-worker.js', import.meta.url), { type: 'module' });
      const port = createPort(
        (m, t) => w.postMessage(m, t),
        (fn) => w.addEventListener('message', (e) => fn(e.data)),
      );
      w.addEventListener('error', (e) => port.failAll(new Error(e.message ?? 'Worker のエラー')));
      workers.push(w); ports.push(port);
    }
    const arch = new ParallelArchipelago(ports, seed, settings);
    const infos = await arch.init();
    const mirror = new SimMirror(infos[view].info, (m) => ports[view].ask(m.type, m));
    const runner = new IslandRunner(workers, ports, arch, mirror, view);
    await runner.fetchFrame(true);
    return runner;
  }
  constructor(workers, ports, arch, mirror, view) {
    Object.assign(this, { workers, ports, arch, mirror, view });
    this.acc = 0; this.busy = false; this.msPerStep = 5; this.lastPanels = -Infinity;
    this.selectedId = null; this.profile = false; this.disposed = false; this.error = null;
  }
  get settings() { return this.arch.settings; }
  reset() { this.acc = 0; }
  // 見ている島の中身を取り寄せて mirror に反映する
  async fetchFrame(panels) {
    const r = await this.ports[this.view].ask('frame', { panels, selectedId: this.selectedId, profile: this.profile });
    this.mirror.applyFrame(r.frame);
    if (r.panels) this.mirror.applyPanels(r.panels);
  }
  // 毎フレーム呼ぶ。dtr: 前フレームからの実時間（秒）。戻り値は計測用 { steps, simSeconds, dropped }
  advance(dtr, speed, { selectedId = null, profile = false } = {}) {
    let dropped = 0, n = 0;
    if (speed > 0 && speed < SPEED_MAX) this.acc += dtr * speed;
    if (this.busy || this.disposed || this.error) {
      // 応答待ちの間は遅れを MAX_BACKLOG で頭打ちにする（全部は捨てない）
      if (this.acc > MAX_BACKLOG) { dropped = this.acc - MAX_BACKLOG; this.acc = MAX_BACKLOG; }
      return { steps: 0, simSeconds: 0, dropped, workerMs: 0 };
    }
    if (speed >= SPEED_MAX) n = Math.max(1, Math.floor(BUDGET_MAX_MS / this.msPerStep));
    else if (speed > 0) { n = Math.min(Math.floor(this.acc / CFG.DT), Math.max(1, Math.floor(BUDGET_MS / this.msPerStep))); this.acc -= n * CFG.DT; }
    // 消費した後に、残りが多すぎるときだけ捨てる（SimRunner と同じ順）
    if (this.acc > MAX_BACKLOG) { dropped += this.acc; this.acc = 0; }
    this.selectedId = selectedId; this.profile = profile;
    const now = performance.now(), panels = now - this.lastPanels >= PANELS_MS;
    if (panels) this.lastPanels = now;
    this.busy = true;
    this.arch.advance(n)
      .then(() => { if (n > 0) this.msPerStep = 0.7 * this.msPerStep + 0.3 * Math.max(0.05, (performance.now() - now) / n); return this.fetchFrame(panels); })
      .then(() => { this.busy = false; })
      .catch((err) => { if (!this.disposed) { this.error = err; console.error(err); } });
    return { steps: n, simSeconds: n * CFG.DT, dropped, workerMs: n * this.msPerStep };
  }
  // Worker をすべて止める。待っている要求は失敗にする
  dispose() { this.disposed = true; for (const w of this.workers) w.terminate(); for (const p of this.ports) p.failAll(new Error('世界を閉じました')); this.mirror.dispose(); }
}
