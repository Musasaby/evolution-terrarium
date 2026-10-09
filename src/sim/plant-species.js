// ===== 植物種の定義 =====
// temp: 最適気温範囲, moist: 最適湿度範囲, maxE: 最大エネルギー
// hh: 高さの半分, col: 当たり判定の半径, soft: 踏み込んで食べられる（センサー）, wet: 水辺に生える
export const PLANT_SPECIES = [
  { name: '草',     temp: [4, 30],   moist: [0.3, 0.85], maxE: 32,  grow: 1.4, spread: 4,  rate: 0.10, life: 160, col: 0.9, hh: 0.35, soft: true },
  { name: '花',     temp: [10, 28],  moist: [0.4, 0.8],  maxE: 22,  grow: 0.8, spread: 6,  rate: 0.08, life: 120, col: 0.55,  hh: 0.3, soft: true },
  { name: '葦',     temp: [8, 34],   moist: [0.82, 1.0], maxE: 30,  grow: 0.55, spread: 3,  rate: 0.09, life: 200, col: 0.6, hh: 0.9, wet: true, soft: true },
  { name: '低木',   temp: [0, 30],   moist: [0.35, 0.8], maxE: 60,  grow: 0.5, spread: 5,  rate: 0.04, life: 400, col: 0.6,  hh: 0.5 },
  { name: '広葉樹', temp: [8, 27],   moist: [0.55, 1.0], maxE: 160, grow: 0.25,spread: 7,  rate: 0.025,life: 900, col: 0.45, hh: 1.6 },
  { name: '針葉樹', temp: [-8, 16],  moist: [0.3, 0.9],  maxE: 140, grow: 0.22,spread: 7,  rate: 0.025,life: 900, col: 0.4,  hh: 1.6 },
  { name: 'サボテン',temp: [18, 45], moist: [0.0, 0.3],  maxE: 80,  grow: 0.3, spread: 6,  rate: 0.03, life: 600, col: 0.4,  hh: 0.9 },
  { name: '苔',     temp: [-15, 12], moist: [0.3, 1.0],  maxE: 16,  grow: 1.4, spread: 4,  rate: 0.10, life: 140, col: 0.9,  hh: 0.12, soft: true },
];

// 値 v が範囲 [a, b] にどれだけ合うか（範囲内で 1、外れるほどガウス的に減る）
export const fit = (v, [a, b], soft) => v >= a && v <= b ? 1 : Math.exp(-(((v < a ? a - v : v - b) / soft) ** 2));
