// ===== シミュレーションの進め方：実時間と倍速から、1フレームに何ステップ進めるかを決める =====
import { CFG } from '../sim/index.js';

const BUDGET_MS = 22;      // 1フレームでシミュレーションに使ってよい時間
const BUDGET_MAX_MS = 30;  // 「最大」速度のときの時間
const MAX_BACKLOG = 0.5;   // これ以上遅れたら、追いつくのをあきらめて捨てる（シム秒）

export const SPEED_MAX = 999;

export class SimRunner {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.acc = 0;
  }
  reset() { this.acc = 0; }

  // dtr: 前フレームからの実時間（秒）。戻り値は計測用の情報
  advance(sim, dtr, speed) {
    const t0 = this.now();
    let steps = 0, dropped = 0;
    if (speed >= SPEED_MAX) {
      const budget = t0 + BUDGET_MAX_MS;
      while (this.now() < budget) { sim.step(); steps++; }
    } else if (speed > 0) {
      const budget = t0 + BUDGET_MS;
      this.acc += dtr * speed;
      while (this.acc >= CFG.DT && this.now() < budget) { sim.step(); steps++; this.acc -= CFG.DT; }
      if (this.acc > MAX_BACKLOG) { dropped = this.acc; this.acc = 0; }
    }
    return { steps, simSeconds: steps * CFG.DT, dropped, ms: this.now() - t0, budgetMs: speed >= SPEED_MAX ? BUDGET_MAX_MS : BUDGET_MS };
  }
}
