// ===== 色の定義（3D 描画と UI パネルで共有する） =====

export const CORPSE_COLOR = '#6b5b4b';

// 種の表示色。遺伝子の体色（sp.hue）は親子でほとんど変わらないので、表示には種の番号から
// 黄金角（約137.5°）ずつずらした色相を使い、隣り合って生まれた種どうしでも見分けやすくする。
// 系統の深さで彩度と明るさを少し変え、色相が近くなっても区別できるようにする。
const GOLDEN = 0.6180339887;
export function speciesHsl(sp) {
  if (!sp) return [0, 0.55, 0];
  const h = (sp.id * GOLDEN + 0.08) % 1;
  const k = (sp.depth ?? 0) % 3;
  return [h, [0.62, 0.48, 0.72][k], [0, 0.06, -0.05][k]];
}
// 種の色（three.js の Color に書き込む）
export function speciesColor(sp, out, light = 0.5) { const [h, s, dl] = speciesHsl(sp); return out.setHSL(h, s, light + dl); }
// 種の色（CSS 文字列）。light は 0〜100
export const speciesCss = (sp, light = 55) => { const [h, s, dl] = speciesHsl(sp); return `hsl(${h * 360} ${s * 100}% ${light + dl * 100}%)`; };

// 植物種ごとの基本色（plant-species.js の name と対応）
export const PLANT_COLORS = {
  草: '#5f9a3e', 花: '#4f8a3a', 葦: '#8a9a52', 低木: '#3f6f34', 広葉樹: '#3d7a35', 針葉樹: '#25543a', サボテン: '#5f8d4e', 苔: '#56703a',
};
export const BLOOM_COLORS = ['#e8d36a', '#e889a6', '#f2efe6', '#a38fe0'];
