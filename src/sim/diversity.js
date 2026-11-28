// ===== 多様性の計算（純粋関数。sim を読むだけで書き換えない） =====
import { isLiving } from './creatures.js';
import { interfertile } from './speciation.js';

const SAMPLE = 3; // 種ごとの代表ゲノムの数（生きている個体を id の小さい順に）

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

// 1 島分の集計材料（純粋関数）。postMessage で送れる形にする
//   living … 生きている個体数。diet … [食性の分類, 数] の配列（はじめて現れた順）
//   groups … 種ごとの { n: 個体数, genomes: 代表ゲノム（id の小さい順に最大 SAMPLE 個） }（種がはじめて現れた順）
export function islandDiversityGroups(sim) {
  const bySp = new Map(), diet = new Map();
  let living = 0;
  for (const c of sim.creatures) {
    if (!isLiving(c)) continue;
    living++;
    const members = bySp.get(c.species);
    if (members) members.push(c); else bySp.set(c.species, [c]);
    // 食性ニッチ: diet < 0.25 = 草, < 0.75 = 木の葉, それ以上 = 肉
    const d = c.genome.diet ?? 0.25;
    const cls = d < 0.25 ? 0 : d < 0.75 ? 1 : 2;
    diet.set(cls, (diet.get(cls) || 0) + 1);
  }
  const groups = [];
  for (const members of bySp.values()) {
    members.sort((a, b) => a.id - b.id);
    groups.push({ n: members.length, genomes: members.slice(0, SAMPLE).map((c) => c.genome) });
  }
  return { living, diet: [...diet], groups };
}

// 群島全体の多様性（純粋関数）。parts は島番号の順の islandDiversityGroups の戻り値。
//   effSpecies        … 種を「島番号:種 id」で別の種として数えた実効種数
//   effSpeciesFertile … 別の島の種どうしを交配可能性で束ねた実効種数
export function combineArchipelagoDiversity(parts) {
  const groups = [];          // { island, n, genomes }（島ごと・種ごと）
  const dietCounts = new Map();
  let living = 0;
  parts.forEach((p, island) => {
    living += p.living;
    for (const [cls, k] of p.diet) dietCounts.set(cls, (dietCounts.get(cls) || 0) + k);
    for (const g of p.groups) groups.push({ island, n: g.n, genomes: g.genomes });
  });
  // union-find：別の島の 2 種で、代表どうしのどれか 1 組が interfertile なら同じ根にまとめる。
  // 同じ島どうしは直接まとめない（fertileCounts と同じ）。根ごとに n を足して fertile（Map）を作る
  const parent = groups.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      if (groups[a].island === groups[b].island || find(a) === find(b)) continue;
      if (groups[a].genomes.some((ga) => groups[b].genomes.some((gb) => interfertile(ga, gb)))) parent[find(a)] = find(b);
    }
  }
  const speciesCounts = new Map();
  groups.forEach((g, i) => speciesCounts.set(i, g.n));
  const fertile = new Map();
  groups.forEach((g, i) => { const r = find(i); fertile.set(r, (fertile.get(r) || 0) + g.n); });
  return {
    living,
    species: groups.length,
    effSpecies: effFromCounts(speciesCounts),
    effDiet: effFromCounts(dietCounts),
    speciesFertile: fertile.size,
    effSpeciesFertile: effFromCounts(fertile),
  };
}

// sims は島の Sim の配列（島番号の順）。戻り値の意味は combineArchipelagoDiversity のとおり
export function computeArchipelagoDiversity(sims) {
  return combineArchipelagoDiversity(sims.map(islandDiversityGroups));
}
