// ===== 多様性の計算（純粋関数。sim を読むだけで書き換えない） =====
import { isLiving } from './creatures.js';

// 標準偏差（母分散）。空配列なら 0
function sd(values) {
  const n = values.length;
  if (n === 0) return 0;
  let s = 0, sq = 0;
  for (const v of values) { s += v; sq += v * v; }
  const mean = s / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean));
}

// exp(H)（シャノン多様度 H の実効数）。カウントマップを渡す
function effFromCounts(counts) {
  let n = 0;
  for (const k of counts.values()) n += k;
  if (n === 0) return 0;
  let H = 0;
  for (const k of counts.values()) { const p = k / n; H -= p * Math.log(p); }
  return Math.exp(H);
}

export function computeDiversity(sim) {
  const live = sim.creatures.filter(isLiving);
  const n = live.length;
  const bySp = new Map();
  for (const c of live) bySp.set(c.species, (bySp.get(c.species) || 0) + 1);
  let H = 0, top = 0;
  for (const k of bySp.values()) { const p = k / n; H -= p * Math.log(p); top = Math.max(top, p); }
  // 食性ニッチ: diet < 0.25 = 草, < 0.75 = 木の葉, それ以上 = 肉
  const dietCounts = new Map();
  for (const c of live) {
    const d = c.genome.diet ?? 0.25;
    const cls = d < 0.25 ? 0 : d < 0.75 ? 1 : 2;
    dietCounts.set(cls, (dietCounts.get(cls) || 0) + 1);
  }
  const volArr = new Array(n), partsArr = new Array(n), dietArr = new Array(n), toptArr = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = live[i];
    volArr[i] = c.vol; partsArr[i] = c.nParts;
    dietArr[i] = c.genome.diet ?? 0.25; toptArr[i] = c.topt;
  }
  const traitSd = {
    vol: sd(volArr), parts: sd(partsArr), diet: sd(dietArr), topt: sd(toptArr),
    tTol: 0, aqua: 0, // tTol / aqua はまだ実装されていないトレイト
  };
  return {
    living: n,
    species: bySp.size,
    shannon: H,
    effSpecies: n ? Math.exp(H) : 0,
    dominance: top,
    effDiet: effFromCounts(dietCounts),
    traitSd,
  };
}
