// ===== 地形：高さ場の生成・隆起と侵食・水域からの距離 =====
// 高さ場（H）だけを持つ独立した部品。物理エンジンの当たり判定は Sim 側が H から作る。
import { CFG, EDGE } from './config.js';
import { clamp, sat } from './math.js';

const N = CFG.GRID, W = N + 1, S = CFG.WORLD;
const BASE_WATER = 1.2;  // 初期の湖面（climate.js の baseWater と同じ値）
const LAKE_FRAC = 0.15;  // 湖の面積合計の、世界の面積に対する割合（格子の解像度によらない）

export class Terrain {
  constructor(rng, noise) {
    this.rng = rng;
    this.H = new Float32Array(W * W);
    this.soil = new Uint8Array(W * W);   // 土壌の種類(0=岩場, 1=砂地, 2=肥沃, 3=泥炭)
    this.distWater = new Float32Array(W * W);
    this.hotspots = [];
    this.generate(noise);
  }

  // 湖がない場合の高さ（湖の深さの決定に使う）
  baseHeight(x, z, nz) {
    let h = 3 + nz(x * 0.027, z * 0.027, 4) * 5;
    for (const mtn of this.mtns) {
      const dm = Math.hypot(x - mtn.x, z - mtn.z);
      const ridge = 1 - Math.abs(nz(x * 0.04 + 50, z * 0.04, 3)) * 2;
      h += mtn.height * Math.exp(-(dm * dm) / (mtn.radius * mtn.radius)) * (0.55 + 0.55 * ridge);
    }
    const edge = Math.max(Math.abs(x), Math.abs(z)) / (S / 2);
    return h + Math.max(0, edge - 0.85) * 40;
  }

  generate(nz) {
    const rng = this.rng;
    // 山（1〜3 個）：高さと裾野の広さも世界ごとにばらつく
    this.mtns = [];
    const nm = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < nm; k++) {
      this.mtns.push({
        x: rng.range(18, 34) * (rng() < 0.5 ? -1 : 1),
        z: rng.range(18, 34) * (rng() < 0.5 ? -1 : 1),
        height: rng.range(14, 26),
        radius: rng.range(18, 30),
      });
    }
    // 湖（1〜3 個）：標高の低い平地に置き、底の平らな甕状の深い窪みで必要な面積を保証する
    this.lakes = [];
    const nl = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < nl; k++) {
      // 候補から標高の最も低い平地を選ぶ（既に置いた湖が半径に入る場所は避ける）
      // 面積は世界の面積（S*S）に対する割合で決める（格子の解像度によらない）
      const rExp = Math.sqrt((LAKE_FRAC / nl) * S * S / Math.PI) / 0.85;
      let bx = 0, bz = 0, bb = Infinity, fb = Infinity, fx = 0, fz = 0;
      for (let tryK = 0; tryK < 10; tryK++) {
        const x = rng.range(-28, 28), z = rng.range(-28, 28);
        let far = true;
        for (const lk of this.lakes) {
          if (Math.hypot(x - lk.x, z - lk.z) < (lk.radius + rExp) * 0.8) far = false;
        }
        const base = this.baseHeight(x, z, nz);
        if (base < fb) { fb = base; fx = x; fz = z; }
        if (!far) continue;
        if (base < bb) { bb = base; bx = x; bz = z; }
      }
      if (!isFinite(bb)) { bb = fb; bx = fx; bz = fz; }
      // 底の深さは湖の縁の最高地点より十分深くして、斜面でも面積を保つ
      let rimMax = bb;
      const water = (LAKE_FRAC / nl) * S * S * rng.range(0.9, 1.1);
      const radius = Math.sqrt(water / Math.PI) / 0.85;
      for (let pv = 0; pv < 8; pv++) {
        const a = (pv / 8) * Math.PI * 2;
        rimMax = Math.max(rimMax, this.baseHeight(bx + radius * 0.8 * Math.cos(a), bz + radius * 0.8 * Math.sin(a), nz));
      }
      // 縁の高さが湖面（BASE_WATER）を下回る地点があると深さが負になるため、正の下限を設ける
      const depth = Math.max(rimMax - BASE_WATER, 2) * rng.range(2.2, 3.0);
      this.lakes.push({ x: bx, z: bz, depth, radius });
    }
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = -S / 2 + i * S / N, z = -S / 2 + j * S / N;
      // 基本土高（山・ノイズ・端の盛り上がり）から湖の窪みを引く。式は baseHeight にまとめる
      let h = this.baseHeight(x, z, nz);
      for (const lk of this.lakes) {
        const dl = Math.hypot(x - lk.x, z - lk.z);
        h -= lk.depth * Math.exp(-(dl * dl * dl) / (lk.radius * lk.radius * lk.radius));
      }
      this.H[i * W + j] = h;
    }
    this.generateSoil(nz);
  }

  // 土壌(0=岩場, 1=砂地, 2=肥沃, 3=泥炭)。生成時に決める静的な格子(自己の侵食では変わらない)。
  // ノイズの場の分位数で陸地を 4 分するので、どの土壌も陸地の約 25% を占める
  generateSoil(nz) {
    const W1 = W, rng = this.rng;
    const score = new Float32Array(W * W);
    const land = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const id = i * W1 + j, x = -S / 2 + i * S / N, z = -S / 2 + j * S / N;
      score[id] = nz(x * 0.06 + 91, z * 0.06 - 53, 3) + 0.5 * nz(x * 0.21, z * 0.21, 2) + rng() * 0.12;
      if (this.H[id] >= BASE_WATER) land.push(id);
    }
    const s = land.map(id => score[id]).sort((a, b) => a - b);
    const q = n => s[Math.min(s.length - 1, Math.floor(s.length * n))];
    const t0 = q(0.25), t1 = q(0.5), t2 = q(0.75);
    for (let id = 0; id < W * W; id++) {
      const v = score[id];
      this.soil[id] = v < t0 ? 0 : v < t1 ? 1 : v < t2 ? 2 : 3;
    }
  }

  heightAt(x, z) {
    const fx = clamp((x + S / 2) / S * N, 0, N - 1e-4), fz = clamp((z + S / 2) / S * N, 0, N - 1e-4);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, H = this.H;
    // 三角形分割に合わせず双線形で近似
    return (H[i * W + j] * (1 - u) + H[(i + 1) * W + j] * u) * (1 - v) + (H[i * W + j + 1] * (1 - u) + H[(i + 1) * W + j + 1] * u) * v;
  }

  // 土壌の種類(0=岩場, 1=砂地, 2=肥沃, 3=泥炭)。静的な格子を引くだけ
  soilAt(x, z) {
    const i = clamp(Math.round((x + S / 2) / S * N), 0, N), j = clamp(Math.round((z + S / 2) / S * N), 0, N);
    return this.soil[i * W + j];
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
