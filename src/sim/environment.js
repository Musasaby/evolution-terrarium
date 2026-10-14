// ===== 環境の問い合わせ：地形と気候を組み合わせた場所ごとの条件 =====
import { fit } from './plant-species.js';

export const tempAt = (terrain, climate, x, z) => climate.tempAtHeight(terrain.heightAt(x, z));
export const meanTempAt = (terrain, climate, x, z) => climate.meanTempAtHeight(terrain.heightAt(x, z));
export const isWater = (terrain, climate, x, z) => terrain.heightAt(x, z) < climate.water;

// 植物種 sp がその場所でどれだけ育ちやすいか（0〜1）。mean=true なら季節をならした気温で評価する
// soil: その場所の土壌の種類(0〜3)。flora の更新では表引きを 1 回にするため外から渡す(省略時はここで引く)
export function suitability(terrain, climate, sp, x, z, mean = true, soil) {
  const h = terrain.heightAt(x, z), wl = climate.water;
  if (sp.wet) { if (h < wl - 0.6 || h > wl + 2.5) return 0; }
  else if (h < wl + 0.05) return 0;
  const T = mean ? meanTempAt(terrain, climate, x, z) * 0.6 + tempAt(terrain, climate, x, z) * 0.4 : tempAt(terrain, climate, x, z);
  const s = fit(T, sp.temp, 5) * fit(terrain.moistureAt(x, z, climate), sp.moist, 0.15);
  return s * sp.soil[soil ?? terrain.soilAt(x, z)];
}
