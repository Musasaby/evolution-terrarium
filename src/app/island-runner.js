// ===== ブラウザで群島を進める：島ごとの Worker を起こし、実時間と倍速からフレームごとに進める =====
// 進め方の規則は sim-runner.js の SimRunner と同じ（予算・最大速度・遅れの捨て方）。
// 姿勢は見ている島（view）の Worker からだけ受け取り、mirror に反映する。
import { ParallelArchipelago, createPort, normalizeSettings, combineArchipelagoDiversity, CFG } from '../sim/index.js';
import { SimMirror } from './sim-mirror.js';
import { SPEED_MAX } from './sim-runner.js';

const BUDGET_MS = 22, BUDGET_MAX_MS = 30, MAX_BACKLOG = 0.5;
const PANELS_MS = 250;   // パネル用の中身を取り寄せる間隔（実時間）
const SUMMARY_MS = 2000;   // 全島の集計を取り寄せる間隔（実時間）。島が 1 つなら取り寄せない

// 移住 1 回分の moves（ParallelArchipelago の onMigrate の引数）から、島ごとの記録の 1 行を作る。島番号は 1 始まりで書く
export function migrationLogs(moves) {
  return moves.map((m) => {
    const out = moves.find((x) => x.from === m.to);
    let msg = `移住：島 ${m.from + 1} から ${m.placed} 体が移ってきて、島 ${out.to + 1} へ ${out.sent} 体が移っていった`;
    if (m.dropped) msg += `（${m.dropped} 体は降り立つ陸地が見つからなかった）`;
    return { island: m.to, msg };
  });
}

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
    const runner = new IslandRunner(workers, ports, arch, mirror, view, infos);
    arch.onMigrate = (moves) => runner.logMigration(moves);
    await runner.fetchFrame(true);
    if (count > 1) await runner.fetchSummary();
    return runner;
  }
  constructor(workers, ports, arch, mirror, view, infos = []) {
    Object.assign(this, { workers, ports, arch, mirror, view, infos });
    this.acc = 0; this.busy = false; this.msPerStep = 5; this.lastPanels = -Infinity;
    this.selectedId = null; this.profile = false; this.disposed = false; this.error = null;
    this.summary = null; this.lastSummary = -Infinity; this.job = null;
  }
  get settings() { return this.arch.settings; }
  reset() { this.acc = 0; }
  // 見ている島の中身を取り寄せて mirror に反映する
  async fetchFrame(panels, fresh = false) {
    const r = await this.ports[this.view].ask('frame', { panels, selectedId: this.selectedId, profile: this.profile, fresh });
    this.mirror.applyFrame(r.frame);
    if (r.panels) this.mirror.applyPanels(r.panels);
  }
  // 全島の集計を取り寄せて、群島全体の多様性をまとめる
  async fetchSummary() {
    this.lastSummary = performance.now();
    const rs = await Promise.all(this.ports.map((p) => p.ask('summary')));
    const parts = rs.map((r) => r.summary);
    const div = combineArchipelagoDiversity(parts);
    this.summary = {
      islands: parts.map((p, i) => ({ index: i, living: p.living, species: p.groups.length })),
      living: div.living, species: div.species, effSpecies: div.effSpecies,
      speciesFertile: div.speciesFertile, effSpeciesFertile: div.effSpeciesFertile,
      migrated: this.arch.migrated, dropped: this.arch.dropped,
    };
  }
  // 移住の記録を、移ってきた島の記録に残す
  logMigration(moves) {
    for (const { island, msg } of migrationLogs(moves)) this.ports[island].ask('log', { msg, kind: 'migrate' }).catch(() => {});
  }
  // 見る島を i に切り替え、新しい写しを返す
  async setView(i) {
    while (this.busy) { if (this.error) throw this.error; await this.job?.catch(() => {}); }   // 進行中の要求が終わるまで待つ
    if (this.disposed || i === this.view || !(i >= 0 && i < this.ports.length)) return this.mirror;
    this.busy = true;
    this.job = (async () => {
      this.ports[this.view].ask('profile', { on: false }).catch(() => {});   // 前の島の区間計測を止める
      this.mirror.dispose();
      this.view = i;
      this.mirror = new SimMirror(this.infos[i].info, (m) => this.ports[i].ask(m.type, m));
      await this.fetchFrame(true, true);   // 送り済みの記録を捨てさせ、すべて送り直させる
      this.lastPanels = performance.now();
    })().finally(() => { this.busy = false; });
    await this.job;
    return this.mirror;
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
    const summary = this.ports.length > 1 && now - this.lastSummary >= SUMMARY_MS;
    this.busy = true;
    this.job = this.arch.advance(n)
      .then(() => { if (n > 0) this.msPerStep = 0.7 * this.msPerStep + 0.3 * Math.max(0.05, (performance.now() - now) / n); return this.fetchFrame(panels); })
      .then(() => (summary ? this.fetchSummary() : null))
      .then(() => { this.busy = false; })
      .catch((err) => { if (!this.disposed) { this.error = err; console.error(err); } });
    return { steps: n, simSeconds: n * CFG.DT, dropped, workerMs: n * this.msPerStep };
  }
  // Worker をすべて止める。待っている要求は失敗にする
  dispose() { this.disposed = true; for (const w of this.workers) w.terminate(); for (const p of this.ports) p.failAll(new Error('世界を閉じました')); this.mirror.dispose(); }
}
