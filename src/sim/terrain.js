// ===== 地形：高さ場の生成・隆起と侵食・水域からの距離 =====
// 高さ場（H）だけを持つ独立した部品。物理エンジンの当たり判定は Sim 側が H から作る。
import { CFG, EDGE } from './config.js';
import { clamp, sat } from './math.js';

const N = CFG.GRID, W = N + 1, S = CFG.WORLD;

export class Terrain {
  constructor(rng, noise) {
    this.rng = rng;
    this.H = new Float32Array(W * W);
    this.distWater = new Float32Array(W * W);
    this.hotspots = [];
    this.generate(noise);
  }

  generate(nz) {
    const rng = this.rng;
    this.mtn = { x: rng.range(18, 34) * (rng() < 0.5 ? -1 : 1), z: rng.range(18, 34) * (rng() < 0.5 ? -1 : 1) };
    this.lake = { x: -this.mtn.x * 0.7 + rng.range(-10, 10), z: -this.mtn.z * 0.4 + rng.range(-10, 10) };
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = -S / 2 + i * S / N, z = -S / 2 + j * S / N;
      let h = 3 + nz(x * 0.027, z * 0.027, 4) * 5;
      const dm = Math.hypot(x - this.mtn.x, z - this.mtn.z);
      const ridge = 1 - Math.abs(nz(x * 0.04 + 50, z * 0.04, 3)) * 2;
      h += 22 * Math.exp(-(dm * dm) / (25 * 25)) * (0.55 + 0.55 * ridge);
      const dl = Math.hypot(x - this.lake.x, z - this.lake.z);
      h -= 8 * Math.exp(-(dl * dl) / (16 * 16));
      const edge = Math.max(Math.abs(x), Math.abs(z)) / (S / 2);
      h += Math.max(0, edge - 0.85) * 40;
      this.H[i * W + j] = h;
    }
  }

  heightAt(x, z) {
    const fx = clamp((x + S / 2) / S * N, 0, N - 1e-4), fz = clamp((z + S / 2) / S * N, 0, N - 1e-4);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, H = this.H;
    // 三角形分割に合わせず双線形で近似
    return (H[i * W + j] * (1 - u) + H[(i + 1) * W + j] * u) * (1 - v) + (H[i * W + j + 1] * (1 - u) + H[(i + 1) * W + j + 1] * u) * v;
  }

  // 隆起と侵食（数秒ごと）。高さが変わったら true を返す
  // t: 現在時刻 / humidity: 湿度（雨による侵食の強さ） / log: 出来事の記録
  update(t, humidity, log) {
    const H = this.H, rng = this.rng;
    if (this.hotspots.length < 2 && rng() < 0.08) {
      const hs = { x: rng.range(-EDGE, EDGE), z: rng.range(-EDGE, EDGE), r: rng.range(8, 18), rate: rng.range(0.006, 0.016) * (rng() < 0.75 ? 1 : -1), until: t + CFG.YEAR * rng.range(1, 3), vx: rng.gauss() * 0.01, vz: rng.gauss() * 0.01 };
      this.hotspots.push(hs);
      log(hs.rate > 0 ? '地殻が隆起を始めた' : '大地が沈降を始めた', 'env');
    }
    this.hotspots = this.hotspots.filter(h => h.until > t);
    const D = new Float32Array(H.length);
    for (const hs of this.hotspots) {
      hs.x += hs.vx * 5; hs.z += hs.vz * 5;
      for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
        const x = -S / 2 + i * S / N, z = -S / 2 + j * S / N;
        const d2 = (x - hs.x) ** 2 + (z - hs.z) ** 2;
        if (d2 < 9 * hs.r * hs.r) D[i * W + j] += hs.rate * Math.exp(-d2 / (hs.r * hs.r));
      }
    }
    // 熱的侵食 + 雨による侵食
    const talus = 0.9, k = 0.01 + 0.03 * humidity;
    for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
      const id = i * W + j, h = H[id];
      for (const nb of [id + 1, id - 1, id + W, id - W]) {
        const dh = h - H[nb];
        if (dh > talus) { const m = (dh - talus) * k; D[id] -= m; D[nb] += m; }
      }
    }
    let maxd = 0;
    for (let i = 0; i < H.length; i++) { const d = clamp(D[i], -0.04, 0.04); H[i] = clamp(H[i] + d, -8, 40); maxd = Math.max(maxd, Math.abs(d)); }
    return maxd > 1e-4;
  }

  // 水域からの距離（チャンファー距離変換）
  computeMoisture(waterLevel) {
    const H = this.H, cell = S / N, D = this.distWater;
    for (let i = 0; i < D.length; i++) D[i] = H[i] < waterLevel ? 0 : 1e9;
    const d1 = cell, d2 = cell * 1.414;
    for (let i = 0; i < W; i++) for (let j = 0; j < W; j++) {
      const id = i * W + j; let v = D[id];
      if (i > 0) { v = Math.min(v, D[id - W] + d1); if (j > 0) v = Math.min(v, D[id - W - 1] + d2); if (j < N) v = Math.min(v, D[id - W + 1] + d2); }
      if (j > 0) v = Math.min(v, D[id - 1] + d1);
      D[id] = v;
    }
    for (let i = N; i >= 0; i--) for (let j = N; j >= 0; j--) {
      const id = i * W + j; let v = D[id];
      if (i < N) { v = Math.min(v, D[id + W] + d1); if (j < N) v = Math.min(v, D[id + W + 1] + d2); if (j > 0) v = Math.min(v, D[id + W - 1] + d2); }
      if (j < N) v = Math.min(v, D[id + 1] + d1);
      D[id] = v;
    }
  }

  // 湿り気（0〜1）：水辺に近いほど、湿度が高いほど湿る
  moistureAt(x, z, climate) {
    const i = clamp(Math.round((x + S / 2) / S * N), 0, N), j = clamp(Math.round((z + S / 2) / S * N), 0, N);
    const d = this.distWater[i * W + j];
    const h = this.H[i * W + j] - climate.water;
    return sat(0.15 + 0.5 * climate.humidity + 0.55 * Math.exp(-d / 10) - Math.max(0, h - 8) * 0.015);
  }
}
