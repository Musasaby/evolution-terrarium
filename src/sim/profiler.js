// ===== 処理時間の計測 =====
// Sim は begin(name) / end(name) を呼ぶだけで、計測結果の使い道（表示など）は知らない。
// 計測しないときは NULL_PROFILER を使うので、オーバーヘッドはほぼない。

export const NULL_PROFILER = Object.freeze({ begin() {}, end() {} });

const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

// 区間ごとの累計時間（ms）と回数を貯める。take() で取り出してリセットする
export class SectionProfiler {
  constructor() {
    this.start = new Map();
    this.total = new Map();
    this.count = new Map();
  }
  begin(name) { this.start.set(name, now()); }
  end(name) {
    const s = this.start.get(name);
    if (s === undefined) return;
    this.total.set(name, (this.total.get(name) || 0) + now() - s);
    this.count.set(name, (this.count.get(name) || 0) + 1);
  }
  // { name: { ms, n } } を返し、累計をリセットする
  take() {
    const out = {};
    for (const [k, ms] of this.total) out[k] = { ms, n: this.count.get(k) || 0 };
    this.total.clear(); this.count.clear();
    return out;
  }
}
