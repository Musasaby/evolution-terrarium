// ===== 並行群島：島ごとの worker に要求を送り、全島をそろえて進めてから移住する =====
// worker の応答順によらず、移住は島番号の順の結果で行うので、結果は 1 スレッド版（Archipelago）と同じになる。
// worker の API は知らない。送受信の関数を createPort に渡して使う（Node でもブラウザでも動く）。
import { normalizeSettings } from './world-settings.js';
import { islandSpecs, isMigrationStep, stepsToNextMigration, migrationSeed, migrationSource } from './island-host.js';

// post(msg, transfer) で要求を送り、listen(fn) で返信を受ける相手を、ask で問い合わせられるようにする
export function createPort(post, listen) {
  let seq = 0;
  const pending = new Map();
  listen((m) => {
    const p = pending.get(m?.id); if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error)); else p.resolve(m);
  });
  return {
    ask(type, payload = {}, transfer = []) {
      const id = ++seq;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); post({ id, type, ...payload }, transfer); });
    },
    // worker が落ちたときなどに、待っている要求をすべて失敗にする
    failAll(err) { for (const p of pending.values()) p.reject(err); pending.clear(); },
  };
}

// worker 側の共通の要求（run / emigrate / immigrate）。知らない type なら null を返す
export function runIslandRequest(host, msg) {
  if (msg.type === 'run') { const t0 = performance.now(); host.run(msg.steps); return { computeMs: performance.now() - t0 }; }
  if (msg.type === 'emigrate') return { migrants: host.emigrate(msg.k, msg.rngSeed) };
  if (msg.type === 'immigrate') return host.immigrate(msg.migrants, msg.rngSeed);
  return null;
}

export class ParallelArchipelago {
  // ports: 島番号の順の port（createPort の戻り値）。数は settings.islands と同じにする
  constructor(ports, seed, settings) {
    this.ports = ports; this.seed = seed;
    this.settings = normalizeSettings(settings);
    this.specs = islandSpecs(seed, this.settings);
    this.stepCount = 0; this.migrated = 0; this.dropped = 0;
    this.onMigrate = null;   // 移住のたびに呼ぶ関数（使う側が代入する）
    this.computeMs = this.specs.map(() => 0);   // 島ごとの run の計算時間の累計
  }
  // 各 worker に島を作らせる。戻り値は島ごとの init の返信
  init() { return Promise.all(this.ports.map((p, i) => p.ask('init', { spec: this.specs[i] }))); }
  // n ステップ進める。移住の区切りでいったん止め、全島がそろってから移住する
  async advance(n) {
    while (n > 0) {
      const m = Math.min(n, stepsToNextMigration(this.settings, this.stepCount));
      const rs = await Promise.all(this.ports.map((p) => p.ask('run', { steps: m })));
      rs.forEach((r, i) => { this.computeMs[i] += r.computeMs; });
      this.stepCount += m; n -= m;
      if (isMigrationStep(this.settings, this.stepCount)) await this.migrate();
    }
  }
  // 全島の移出を待ってから、全島に移入させる。島 i は migrationSource(i, n) の移民を受け取る
  async migrate() {
    const n = this.ports.length, k = this.settings.migrants;
    const out = await Promise.all(this.ports.map((p, i) => p.ask('emigrate', { k, rngSeed: migrationSeed(this.seed, this.stepCount, i) })));
    const imm = await Promise.all(this.ports.map((p, i) => {
      const src = migrationSource(i, n);
      return p.ask('immigrate', { migrants: out[src].migrants, rngSeed: migrationSeed(this.seed, this.stepCount, src) });
    }));
    for (const r of imm) { this.migrated += r.placed; this.dropped += r.dropped; }
    // 島 i の行き来: from から sent 体が送られ、placed 体が降り立ち、dropped 体は陸地が無く消えた
    const moves = imm.map((r, i) => {
      const from = migrationSource(i, n);
      return { to: i, from, sent: out[from].migrants.length, placed: r.placed, dropped: r.dropped };
    });
    this.onMigrate?.(moves, this.stepCount);
  }
}
