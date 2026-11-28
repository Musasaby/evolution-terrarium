// ===== 水の中の力：浮力（水面より下の体節を持ち上げる） =====
import { CFG } from './config.js';

const G = 9.81;

// 体節の浸かった割合（0〜1）。中心の高さ y・半径 r の球として近似する
export function submerged(y, r, wl) { return Math.min(1, Math.max(0, (wl - (y - r)) / (2 * r))); }

// 水面 wl より下の体節に、上向きの力積（体節の質量 × G × BUOYANCY × 浸かった割合 × dt）をかける。物理ステップの前に毎ステップ呼ぶ
// c.masses（体節ごとの質量）と c.pos（姿勢の写し）を使う。戻り値は中心が水面より下の体節の数（今の updateCreatures の sub と同じ数え方）
export function applyWater(c, wl, dt) {
  let sub = 0;
  for (let i = 0; i < c.bodies.length; i++) {
    const P = c.pos[i];
    if (P.y < wl) sub++;
    const s = submerged(P.y, c.genome.parts[i].r, wl);
    if (s > 0) c.bodies[i].applyImpulse({ x: 0, y: c.masses[i] * G * CFG.BUOYANCY * s * dt, z: 0 }, true);
  }
  return sub;
}
