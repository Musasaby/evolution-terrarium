// 湖の形の確認（計画時の一時スクリプト。T6 で正式に入れる）
//   node tools/lake-shape-check.mjs <シード,...>
// 世界を作った直後の地形について、水面（1.2 m）より低い格子の割合・最も低い地面・水際の最大勾配を出す
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim } from '../src/sim/index.js';

await RAPIER.init();
const seeds = (process.argv[2] ?? '1,2').split(',').map(Number);
const WL = 1.2;
for (const seed of seeds) {
  const sim = new Sim(RAPIER, seed);
  const t = sim.terrain, H = t.H, W = t.W, N = t.N, cell = t.S / N;
  let wet = 0, min = Infinity, maxSlope = 0;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const h = H[i * W + j];
    if (h < WL) wet++;
    min = Math.min(min, h);
    if (i < N && j < N && Math.abs(h - WL) < 1) {
      const gx = (H[(i + 1) * W + j] - h) / cell, gz = (H[i * W + j + 1] - h) / cell;
      maxSlope = Math.max(maxSlope, Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI);
    }
  }
  console.log(`seed ${seed}: 湖 ${t.lakes.length} 個・水面より低い格子 ${(wet / (W * W) * 100).toFixed(1)}%・最も低い地面 ${min.toFixed(1)} m・水際の最大勾配 ${maxSlope.toFixed(0)}°`);
}
