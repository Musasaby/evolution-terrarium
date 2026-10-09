// ===== 色の定義（3D 描画と UI パネルで共有する） =====

export const CORPSE_COLOR = '#6b5b4b';

// 種の色（three.js の Color に書き込む）
export function speciesColor(sp, out, light = 0.5) { return out.setHSL(sp ? sp.hue : 0, 0.55, light); }
// 種の色（CSS 文字列）。light は 0〜100
export const speciesCss = (sp, light = 55) => `hsl(${(sp ? sp.hue : 0) * 360} 55% ${light}%)`;

// 植物種ごとの基本色（plant-species.js の name と対応）
export const PLANT_COLORS = {
  草: '#5f9a3e', 花: '#4f8a3a', 葦: '#8a9a52', 低木: '#3f6f34', 広葉樹: '#3d7a35', 針葉樹: '#25543a', サボテン: '#5f8d4e', 苔: '#56703a',
};
export const BLOOM_COLORS = ['#e8d36a', '#e889a6', '#f2efe6', '#a38fe0'];
