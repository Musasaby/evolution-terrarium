// ===== 環境の問い合わせ：地形と気候を組み合わせた場所ごとの条件 =====
import { fit } from './plant-species.js';

export const tempAt = (terrain, climate, x, z) => climate.tempAtHeight(terrain.heightAt(x, z));
export const meanTempAt = (terrain, climate, x, z) => climate.meanTempAtHeight(terrain.heightAt(x, z));
export const isWater = (terrain, climate, x, z) => terrain.heightAt(x, z) < climate.water;

// 植物種 sp がその場所でどれだけ育ちやすいか（0〜1）。mean=true なら季節をならした気温で評価する
export function suitability(terrain, climate, sp, x, z, mean = true) {
  const h = terrain.heightAt(x, z), wl = climate.water;
  if (sp.wet) { if (h < wl - 0.6 || h > wl + 2.5) return 0; }
  else if (h < wl + 0.05) return 0;
  const T = mean ? meanTempAt(terrain, climate, x, z) * 0.6 + tempAt(terrain, climate, x, z) * 0.4 : tempAt(terrain, climate, x, z);
  return fit(T, sp.temp, 5) * fit(terrain.moistureAt(x, z, climate), sp.moist, 0.15);
}
