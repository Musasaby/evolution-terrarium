// ===== 遺伝子：ゲノムの生成・組換え・突然変異・系統距離 =====
// 状態を持たない純粋なロジック（中立マーカーの対立遺伝子番号の採番だけはモジュール内で持つ）。
import { CFG, MAXJ, NI, NH, NO, NW1, NW2, NWB } from './config.js';
import { clamp, circDiff } from './math.js';

// ゲノムの構成
//  ・体節（カプセル形のパーツ）: 各パーツの形・付け根・関節の動き。パーツとその関節を動かす神経は同じ連鎖ブロックで遺伝する
//  ・神経: 隠れニューロン単位の連鎖ブロック
//  ・中立マーカー: 適応に関係しない座位。突然変異だけが溜まる「分子時計」で、系統の離れ具合を表す
//  ・体色と選り好み: 配偶者を見分ける信号と、その許容幅
//  ・食性 diet（0=草, 0.5=木の葉, 1=肉）と適温 topt（℃）: 生き方の違い（ニッチ）
export const NMARK = 48;
const MU = {
  quant: 0.05,   // 量的形質1つあたりの突然変異率（世代あたり）
  big: 0.1,      // そのうち効果の大きい変異の割合
  brain: 0.02,   // 神経結合1本あたり
  mark: 0.015,   // 中立マーカー1座位あたり（新しい対立遺伝子が生じる）
  dup: 0.03,     // 体節の重複（左右対称の対になりやすい）
  del: 0.015,    // 体節の欠失
  move: 0.008,   // 付け根の移動
  novel: 0.004,  // 新しい体節の出現
};
let alleleSeq = 1;
export const newAllele = () => alleleSeq++;
function randBrain(rng, scale = 0.3) {
  const b = new Float32Array(NWB);
  for (let i = 0; i < NWB; i++) b[i] = rng.gauss() * scale / Math.sqrt(i < NW1 ? 8 : 6);
  return b;
}
export function randomGenome(rng) {
  const n = rng.int(2, 5);
  const parts = [{ r: rng.range(0.15, 0.4), len: rng.range(0.5, 1.6) }];
  for (let i = 1; i < n; i++) parts.push(randPart(rng, rng.int(0, i - 1)));
  const marks = new Int32Array(NMARK);
  for (let i = 0; i < NMARK; i++) marks[i] = newAllele();
  return { parts, freq: rng.range(0.4, 1.6), hue: rng(), pick: rng.range(0.25, 0.5), taxis: rng.range(-2.5, 2.5), seek: rng.range(0, 1.5), diet: rng.range(0, 0.8), topt: rng.range(8, 24), brain: randBrain(rng), marks };
}
function randPart(rng, parent) {
  return {
    r: rng.range(0.08, 0.3), len: rng.range(0.3, 1.4), parent,
    t: rng.range(-1, 1), az: rng.range(0, Math.PI * 2), a0: rng.range(-2, 2),
    range: rng.range(0.4, 1.2), str: rng.range(0.6, 2),
    amp: rng.range(0.3, 1.6), ph: rng.range(0, Math.PI * 2), tw: rng.range(-1.2, 1.2),
  };
}
const PART_LIM = { r: [0.06, 0.55], len: [0.15, 2.4], t: [-1, 1], a0: [-2.6, 2.6], range: [0.05, 1.5], str: [0.1, 4], amp: [0, 2.5], tw: [-2, 2] };
const PART_SIG = { r: 0.03, len: 0.1, t: 0.15, az: 0.25, a0: 0.2, range: 0.1, str: 0.2, amp: 0.2, ph: 0.4, tw: 0.25 };

export function cloneGenome(g) {
  return { parts: g.parts.map(p => ({ ...p })), freq: g.freq, hue: g.hue, pick: g.pick, taxis: g.taxis ?? 0, seek: g.seek ?? 0, diet: g.diet ?? 0.25, topt: g.topt ?? 17, brain: new Float32Array(g.brain), marks: new Int32Array(g.marks) };
}
// 関節スロット j の神経結合（入力行・出力列）
function slotIdx(j) {
  const idx = [];
  for (let h = 0; h < NH; h++) idx.push((18 + j) * NH + h, NW1 + NH + h * NO + j);
  idx.push(NW1 + NH + NW2 + j);
  return idx;
}
const SLOT = Array.from({ length: MAXJ }, (_, j) => slotIdx(j));
const IS_SLOT = new Uint8Array(NWB); for (const s of SLOT) for (const i of s) IS_SLOT[i] = 1;
// ニューロン h に属する（関節スロット以外の）結合
const NEURON = Array.from({ length: NH }, (_, h) => {
  const idx = [];
  for (let i = 0; i < NI; i++) { const k = i * NH + h; if (!IS_SLOT[k]) idx.push(k); }
  idx.push(NW1 + h);
  for (let o = 0; o < NO; o++) { const k = NW1 + NH + h * NO + o; if (!IS_SLOT[k]) idx.push(k); }
  return idx;
});
const OUT_BIAS = []; for (let o = 0; o < NO; o++) { const k = NW1 + NH + NW2 + o; if (!IS_SLOT[k]) OUT_BIAS.push(k); }
function brainRemoveSlot(b, j) {
  const nb = new Float32Array(b);
  for (let k = j; k < MAXJ - 1; k++) { const to = SLOT[k], from = SLOT[k + 1]; for (let i = 0; i < to.length; i++) nb[to[i]] = b[from[i]]; }
  for (const i of SLOT[MAXJ - 1]) nb[i] = 0;
  return nb;
}
function brainCopySlot(dst, src, from, to) { const a = SLOT[from], b = SLOT[to]; for (let i = 0; i < a.length; i++) dst[b[i]] = src[a[i]]; }

// 減数分裂の組換え：連鎖した座位の並びに、ふつう1〜2か所の交叉が起きる
function strand(n, rng) {
  const out = new Uint8Array(n);
  let s = rng() < 0.5 ? 0 : 1;
  const u = rng(), k = u < 0.25 ? 0 : u < 0.8 ? 1 : 2;
  const cuts = []; for (let i = 0; i < k; i++) cuts.push(rng.int(1, Math.max(1, n - 1)));
  for (let i = 0; i < n; i++) { if (cuts.includes(i)) s ^= 1; out[i] = s; }
  return out;
}
export function recombine(a, b, rng) {
  const P = [a, b];
  // 体節の連鎖群（体節の並び順＝相同な位置どうしで対合）
  const nMax = Math.max(a.parts.length, b.parts.length);
  const st = strand(nMax, rng);
  const parts = [], partSrc = [];
  for (let i = 0; i < nMax; i++) {
    const src = P[st[i]];
    if (i >= src.parts.length) break;          // こちらの染色体には続きがない
    parts.push({ ...src.parts[i] }); partSrc.push(st[i]);
  }
  // 神経：ニューロン単位の連鎖群
  const brain = new Float32Array(NWB);
  const sn = strand(NH, rng);
  for (let h = 0; h < NH; h++) { const src = P[sn[h]].brain; for (const k of NEURON[h]) brain[k] = src[k]; }
  for (const k of OUT_BIAS) brain[k] = P[rng() < 0.5 ? 0 : 1].brain[k];
  // 関節を動かす神経は体節と同じブロックで受け継ぐ
  for (let i = 1; i < parts.length; i++) brainCopySlot(brain, P[partSrc[i]].brain, i - 1, i - 1);
  // 中立マーカー：2本の連鎖群
  const marks = new Int32Array(NMARK), half = NMARK / 2;
  for (let c = 0; c < 2; c++) { const sm = strand(half, rng); for (let i = 0; i < half; i++) marks[c * half + i] = P[sm[i]].marks[c * half + i]; }
  // 多数の遺伝子が関わる量的形質：両親の中間を中心にばらつく
  const mid = (x, y, sd) => (x + y) / 2 + rng.gauss() * (Math.abs(x - y) / 2 * 0.6 + sd);
  return {
    parts, brain, marks,
    freq: clamp(mid(a.freq, b.freq, 0), 0.1, 3),
    hue: (a.hue + circDiff(a.hue, b.hue) / 2 + rng.gauss() * Math.abs(circDiff(a.hue, b.hue)) * 0.3 + 1) % 1,
    pick: clamp(mid(a.pick, b.pick, 0), 0, 1),
    taxis: clamp(mid(a.taxis ?? 0, b.taxis ?? 0, 0), -4, 4),
    seek: clamp(mid(a.seek ?? 0, b.seek ?? 0, 0), -2, 3),
    diet: clamp(mid(a.diet ?? 0.25, b.diet ?? 0.25, 0), 0, 1),
    topt: clamp(mid(a.topt ?? 17, b.topt ?? 17, 0), -10, 40),
  };
}
// 突然変異：ほとんどは小さな効果、まれに大きな効果。体節は重複・欠失で数が変わる
export function mutate(g, rng, rate = 1) {
  const muts = [];
  let point = 0, big = 0;
  for (let i = 0; i < g.parts.length; i++) {
    const p = g.parts[i];
    for (const k in PART_SIG) {
      if (p[k] === undefined || rng() > MU.quant * rate) continue;
      const large = rng() < MU.big;
      p[k] += rng.gauss() * PART_SIG[k] * (large ? 4 : 1);
      if (PART_LIM[k]) p[k] = clamp(p[k], ...PART_LIM[k]);
      point++; if (large) big++;
    }
  }
  if (rng() < MU.quant * rate) { g.freq = clamp(g.freq + rng.gauss() * 0.1, 0.1, 3); point++; }
  if (rng() < MU.quant * rate) { g.pick = clamp(g.pick + rng.gauss() * 0.08, 0, 1); point++; }
  if (rng() < MU.quant * rate) { g.taxis = clamp((g.taxis ?? 0) + rng.gauss() * 0.4, -4, 4); point++; }
  if (rng() < MU.quant * rate) { g.seek = clamp((g.seek ?? 0) + rng.gauss() * 0.3, -2, 3); point++; }
  if (rng() < MU.quant * rate) { g.diet = clamp((g.diet ?? 0.25) + rng.gauss() * 0.06, 0, 1); point++; }
  if (rng() < MU.quant * rate) { g.topt = clamp((g.topt ?? 17) + rng.gauss() * 1.0, -10, 40); point++; }
  if (rng() < 0.3 * rate) g.hue = (g.hue + rng.gauss() * 0.012 + 1) % 1;
  for (let i = 0; i < NWB; i++) if (rng() < MU.brain * rate) { g.brain[i] += rng.gauss() * 0.3; point++; }
  let neutral = 0;
  for (let i = 0; i < NMARK; i++) if (rng() < MU.mark * rate) { g.marks[i] = newAllele(); neutral++; }

  // 体節の重複：既存の体節と神経をそのまま複製する（多くは反対側へ付き、左右の対になる）
  if (rng() < MU.dup * rate && g.parts.length > 1 && g.parts.length < CFG.MAXP) {
    const i = rng.int(1, g.parts.length - 1), src = g.parts[i];
    const mirror = rng() < 0.7;
    const q = { ...src, az: mirror ? (src.az + Math.PI) % (Math.PI * 2) : src.az, t: mirror ? src.t : clamp(src.t + rng.range(-0.4, 0.4), -1, 1), ph: mirror ? src.ph + Math.PI : src.ph + rng.range(-0.5, 0.5) };
    g.parts.push(q);
    brainCopySlot(g.brain, g.brain, i - 1, g.parts.length - 2);
    muts.push(mirror ? '体節の重複（左右対）' : '体節の重複');
  }
  if (rng() < MU.novel * rate && g.parts.length < CFG.MAXP) {
    g.parts.push(randPart(rng, rng.int(0, g.parts.length - 1)));
    const j = g.parts.length - 2;
    for (const k of SLOT[j]) g.brain[k] = rng.gauss() * 0.3;
    muts.push('新しい体節');
  }
  if (rng() < MU.del * rate && g.parts.length > 1) {
    const leaves = [];
    for (let i = 1; i < g.parts.length; i++) if (!g.parts.some(q => q.parent === i)) leaves.push(i);
    if (leaves.length) {
      const k = rng.pick(leaves);
      g.parts.splice(k, 1);
      for (const q of g.parts) if (q.parent > k) q.parent--;
      g.brain = brainRemoveSlot(g.brain, k - 1);
      muts.push('体節の欠失');
    }
  }
  if (rng() < MU.move * rate && g.parts.length > 2) {
    const i = rng.int(2, g.parts.length - 1);
    g.parts[i].parent = rng.int(0, i - 1);
    muts.push('付け根の移動');
  }
  if (big) muts.unshift(`大きな形の変異×${big}`);
  if (point) muts.push(`点突然変異×${point}`);
  if (neutral) muts.push(`中立変異×${neutral}`);
  return muts;
}
// 中立マーカーの違い（0〜1）
export function markerDivergence(a, b) {
  let d = 0; for (let i = 0; i < NMARK; i++) if (a.marks[i] !== b.marks[i]) d++;
  return d / NMARK;
}
// 体のつくりの違い
export function morphDistance(a, b) {
  const n = Math.min(a.parts.length, b.parts.length);
  let pd = 0;
  for (let i = 0; i < n; i++) {
    const p = a.parts[i], q = b.parts[i];
    pd += Math.abs(p.r - q.r) / 0.3 + Math.abs(p.len - q.len) / 1.5;
    if (i > 0) {
      let daz = Math.abs(p.az - q.az) % (2 * Math.PI); if (daz > Math.PI) daz = 2 * Math.PI - daz;
      pd += Math.abs(p.a0 - q.a0) / 3 + daz / Math.PI * 0.5 + (p.parent !== q.parent ? 0.6 : 0);
    }
  }
  return pd / Math.max(1, n) * 0.5;
}
export function geneDistance(a, b) {
  return 0.7 * markerDivergence(a, b) + 0.3 * morphDistance(a, b) + 0.2 * Math.abs(a.parts.length - b.parts.length) + nicheDistance(a, b);
}
// 生き方（食性・適温）の違い。生き方が分かれた集団ほど雑種がうまく育たない（生態的種分化）
export function nicheDistance(a, b) {
  return 0.5 * Math.abs((a.diet ?? 0.25) - (b.diet ?? 0.25)) + Math.abs((a.topt ?? 17) - (b.topt ?? 17)) / 25;
}
// 食性から、各食べ物の効率を求める（草・木の葉・肉）
export function dietEfficiency(g) {
  const d = g.diet ?? 0.25;
  const e = (c) => CFG.DIET_FLOOR + CFG.DIET_PEAK * Math.exp(-(((d - c) / CFG.DIET_WIDTH) ** 2));
  return { soft: e(0), hard: e(0.5), meat: e(1) };
}
export function dietName(g) {
  const d = g.diet ?? 0.25;
  return d < 0.2 ? '草食' : d < 0.35 ? '草・木の葉' : d < 0.65 ? '木の葉食' : d < 0.8 ? '木の葉・肉' : '肉食';
}
// 雑種の生存力（0〜1）。系統が離れるほど、別々に生じた遺伝子どうしが噛み合わなくなる（ドブジャンスキー＝マラー不和合）
export function compatibility(a, b) {
  if (Math.abs(a.parts.length - b.parts.length) >= 2) return 0; // 体節数が大きく違うと染色体が対合できない
  const d = geneDistance(a, b);
  return Math.exp(-((d / 0.55) ** 4));
}
// 配偶者の認識：体色と体つき（大きさ・体節数）が、自分の許容幅（選り好みの強さで決まる）に収まるか
export function recognizes(chooser, other) {
  const k = 1 - chooser.pick;
  const dh = Math.abs(circDiff(chooser.hue, other.hue));
  const va = chooser._vol ?? (chooser._vol = genomeStats(chooser).vol), vb = other._vol ?? (other._vol = genomeStats(other).vol);
  const ds = Math.abs(Math.log((va + 0.02) / (vb + 0.02)));
  const dn = Math.abs(chooser.parts.length - other.parts.length);
  return Math.exp(-((dh / (0.04 + 0.3 * k)) ** 2) - ((ds / (0.15 + 0.6 * k)) ** 2) - dn * (0.3 + 1.5 * chooser.pick));
}
// 体節はカプセル（両端が半球の円柱）。端から端までの長さが len、半径が r。
// len < 2r のときは半径 r の球になる（胴の部分がなくなる）
export const capsuleHalf = (p) => Math.max(0, p.len / 2 - p.r);
export function genomeStats(g) {
  let vol = 0, area = 0;
  for (const p of g.parts) {
    const body = 2 * capsuleHalf(p), r = p.r;
    vol += Math.PI * r * r * body + (4 / 3) * Math.PI * r * r * r;
    area += 2 * Math.PI * r * body + 4 * Math.PI * r * r;
  }
  return { vol, area, n: g.parts.length };
}
