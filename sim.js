// ===== 進化シミュレータ コア（描画非依存） =====
// RAPIER を外から注入して使う。ブラウザでも Node でも動く。

export const CFG = {
  WORLD: 120,          // 世界の一辺
  GRID: 64,            // 地形の分割数
  DT: 1 / 30,          // 物理ステップ
  YEAR: 300,           // 1年の長さ（シム秒）
  MAXP: 10,            // 最大パーツ数
  MAX_POP: 200,
  MIN_POP: 30,         // これを下回ると新種の群れが移入する
  INIT_SPECIES: 14,
  GROUP: 8,            // 1種あたりの初期個体数
  MATE_E: 0.55,         // 繁殖に必要なエネルギー（最大値に対する割合）
  INVEST: 0.35,         // 繁殖で親が差し出すエネルギーの割合
  CHILD_COST: 0.19,    // 子1体に必要なエネルギー（子の最大エネルギーに対する割合）
  MAX_LITTER: 8,
  MATE_COST: 0.08,     // 繁殖行為そのものに使うエネルギー（各親の最大エネルギーに対する割合）
  MAX_PLANTS: 2000,
  DENSITY: 40,
  FOOD_GAIN: 3,
  GRAZE_FLOOR: 0.2,    // 草がここまで食べ尽くされると、しばらく回復を待つ
  RECOVER: [10, 20],   // 食べ尽くされた草が再び育ち始めるまでの秒数
  CANOPY: 1.1,         // 木の葉に届く高さ（地面からの m）        // 食べた量に対して得られるエネルギーの倍率
  SENSE_R: 14,
  FERTILE: 0.5,        // 雑種の生存力がこれ以上なら「同じ種」とみなす
};
const MAXJ = CFG.MAXP - 1;
const EDGE = CFG.WORLD / 2 - 4;
const NMEM = 2;
export const NI = 18 + MAXJ + NMEM;
export const NH = 12;
export const NO = MAXJ + NMEM + 2; // 関節 + 記憶 + 旋回 + 推進
const O_TURN = MAXJ + NMEM, O_GO = MAXJ + NMEM + 1;
const NW1 = NI * NH, NW2 = NH * NO, NWB = NW1 + NH + NW2 + NO;

// ---------- 乱数・ノイズ ----------
export function makeRng(seed) {
  let s = seed >>> 0;
  const r = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.gauss = () => { let u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  r.pick = (a) => a[Math.floor(r() * a.length)];
  return r;
}
function makeNoise(rng) {
  const P = new Uint8Array(512), G = [];
  for (let i = 0; i < 256; i++) { P[i] = i; const a = rng() * Math.PI * 2; G.push([Math.cos(a), Math.sin(a)]); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const f = t => t * t * t * (t * (t * 6 - 15) + 10);
  const n2 = (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
    const g = (i, j, dx, dy) => { const v = G[P[P[X + i] + Y + j] & 255]; return v[0] * dx + v[1] * dy; };
    const u = f(x), v = f(y);
    const a = g(0, 0, x, y) + u * (g(1, 0, x - 1, y) - g(0, 0, x, y));
    const b = g(0, 1, x, y - 1) + u * (g(1, 1, x - 1, y - 1) - g(0, 1, x, y - 1));
    return a + v * (b - a);
  };
  return (x, y, oct = 4) => { let s = 0, a = 1, fr = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * n2(x * fr, y * fr); n += a; a *= 0.5; fr *= 2; } return s / n; };
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sat = v => clamp(v, 0, 1);

// ---------- クォータニオン ----------
const qMul = (a, b) => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
const qAxis = (ax, a) => { const s = Math.sin(a / 2); return { x: ax.x * s, y: ax.y * s, z: ax.z * s, w: Math.cos(a / 2) }; };
export function qRot(q, v) {
  const { x, y, z, w } = q;
  const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
  return { x: v.x + w * tx + (y * tz - z * ty), y: v.y + w * ty + (z * tx - x * tz), z: v.z + w * tz + (x * ty - y * tx) };
}
const qConj = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

// ---------- 植物種 ----------
// temp: 最適気温範囲, moist: 最適湿度範囲, maxE: 最大エネルギー
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
const fit = (v, [a, b], soft) => v >= a && v <= b ? 1 : Math.exp(-(((v < a ? a - v : v - b) / soft) ** 2));

// ---------- 遺伝子 ----------
// ゲノムの構成
//  ・体節（円柱パーツ）: 各パーツの形・付け根・関節の動き。パーツとその関節を動かす神経は同じ連鎖ブロックで遺伝する
//  ・神経: 隠れニューロン単位の連鎖ブロック
//  ・中立マーカー: 適応に関係しない座位。突然変異だけが溜まる「分子時計」で、系統の離れ具合を表す
//  ・体色と選り好み: 配偶者を見分ける信号と、その許容幅
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
const newAllele = () => alleleSeq++;
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
  return { parts, freq: rng.range(0.4, 1.6), hue: rng(), pick: rng.range(0.25, 0.5), taxis: rng.range(-2.5, 2.5), seek: rng.range(0, 1.5), brain: randBrain(rng), marks };
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
  return { parts: g.parts.map(p => ({ ...p })), freq: g.freq, hue: g.hue, pick: g.pick, taxis: g.taxis ?? 0, seek: g.seek ?? 0, brain: new Float32Array(g.brain), marks: new Int32Array(g.marks) };
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
const circDiff = (a, b) => { let d = b - a; if (d > 0.5) d -= 1; if (d < -0.5) d += 1; return d; };
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
  return 0.7 * markerDivergence(a, b) + 0.3 * morphDistance(a, b) + 0.2 * Math.abs(a.parts.length - b.parts.length);
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
export function genomeStats(g) {
  let vol = 0, area = 0;
  for (const p of g.parts) { vol += Math.PI * p.r * p.r * p.len; area += 2 * Math.PI * p.r * (p.len + p.r); }
  return { vol, area, n: g.parts.length };
}

const SYL = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワガギグゲゴザジズゼゾダデドバビブベボパピプペポ';
function speciesName(rng) {
  let s = '';
  const n = rng.int(2, 4);
  for (let i = 0; i < n; i++) s += SYL[Math.floor(rng() * SYL.length)];
  return s + rng.pick(['ムシ', 'モドキ', 'ガイ', 'ジュウ', 'ノコ', 'ダマ', 'ボウ', 'アシ']);
}

// ====================================================================
export class Sim {
  constructor(RAPIER, seed = 1) {
    this.R = RAPIER;
    this.seed = seed;
    this.rng = makeRng(seed);
    this.noise = makeNoise(this.rng);
    this.t = 0;
    this.stepCount = 0;
    this.nextCreatureId = 1;
    this.nextSpeciesId = 1;
    this.creatures = [];
    this.plants = [];
    this.species = new Map();
    this.colliderOwner = new Map(); // collider handle -> {kind, obj, part}
    this.grazing = new Map(); // key -> {plant, owner}
    this.events = [];
    this.stats = [];
    this.counters = { births: 0, deaths: 0, predations: 0, matings: 0, stillborn: 0, rejected: 0 };
    this.rejectUntil = new Map();
    this.terrainVersion = 0;
    this.plantVersion = 0;

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = CFG.DT;
    this.eventQueue = new RAPIER.EventQueue(true);
    const owner = this.colliderOwner;
    this.hooks = {
      filterContactPair: (c1, c2) => {
        const a = owner.get(c1), b = owner.get(c2);
        if (a && b && a.kind === 'c' && b.kind === 'c' && a.obj === b.obj) return null;
        return RAPIER.SolverFlags.COMPUTE_IMPULSE;
      },
      filterIntersectionPair: () => true,
    };

    this.initClimate();
    this.initTerrain();
    this.buildTerrainCollider();
    this.computeMoisture();
    this.initPlants();
    for (let i = 0; i < CFG.INIT_SPECIES; i++) this.spawnFounderGroup(CFG.GROUP);
  }

  log(msg, kind = 'info') {
    this.events.unshift({ t: this.t, msg, kind });
    if (this.events.length > 120) this.events.pop();
  }

  // ---------------- 気候 ----------------
  initClimate() {
    this.climate = {
      drift: 0, ice: 0, iceTarget: 0, iceUntil: -1,
      weather: 'clear', weatherUntil: 30, humidity: 0.55,
      baseWater: 1.2, water: 1.2, temp: 15, meanTemp: 15, rainVis: 0,
    };
  }
  get year() { return this.t / CFG.YEAR; }
  seasonName() {
    const ph = ((this.t / CFG.YEAR) % 1 + 1) % 1;
    return ['春', '夏', '秋', '冬'][Math.floor(((ph + 0.125) % 1) * 4)];
  }
  updateClimate(dt) {
    const c = this.climate, rng = this.rng;
    const season = Math.sin((this.t / CFG.YEAR) * Math.PI * 2);
    c.drift += rng.gauss() * 0.04 * Math.sqrt(dt) - c.drift * 0.0005 * dt;
    c.drift = clamp(c.drift, -5, 5);
    // 氷河期
    if (c.iceTarget === 0 && this.t > CFG.YEAR * 2 && rng() < dt / (CFG.YEAR * 7)) this.startIceAge();
    if (c.iceTarget < 0 && this.t > c.iceUntil) { c.iceTarget = 0; this.log('氷河期が終わり、温暖化が始まった', 'env'); }
    c.ice += (c.iceTarget - c.ice) * Math.min(1, dt / 60);
    c.temp = 15 + 11 * season + c.drift + c.ice;
    c.meanTemp += (c.temp - c.meanTemp) * Math.min(1, dt / (CFG.YEAR * 0.6));
    // 天候
    if (this.t > c.weatherUntil) {
      const r = rng();
      const wetBias = 0.1 * Math.sin((this.t / CFG.YEAR) * Math.PI * 2 + 1);
      const prev = c.weather;
      c.weather = r < 0.33 + wetBias ? 'rain' : r < 0.78 ? 'clear' : 'drought';
      c.weatherUntil = this.t + rng.range(20, 70) * (c.weather === 'drought' ? 1.8 : 1);
      if (c.weather !== prev) {
        if (c.weather === 'drought') this.log('干ばつが始まった', 'env');
        if (c.weather === 'rain') this.log(c.temp < 0 ? '雪が降り始めた' : '雨が降り始めた', 'env');
      }
    }
    const tgtH = c.weather === 'rain' ? 1 : c.weather === 'drought' ? 0 : 0.5;
    c.humidity += (tgtH - c.humidity) * Math.min(1, dt / 90);
    const dw = c.weather === 'rain' ? 0.012 : c.weather === 'drought' ? -0.014 : -0.002;
    const evap = c.temp > 25 ? -0.004 : 0;
    c.water = clamp(c.water + (dw + evap) * dt, c.baseWater - 2.8, c.baseWater + 2.8 + Math.min(0, c.ice * 0.1));
    c.rainVis += ((c.weather === 'rain' ? 1 : 0) - c.rainVis) * Math.min(1, dt / 3);
  }
  startIceAge() {
    const c = this.climate;
    c.iceTarget = -this.rng.range(11, 16);
    c.iceUntil = this.t + CFG.YEAR * this.rng.range(1.5, 3);
    this.log('氷河期が始まった', 'env');
  }
  forceWeather(w) {
    const c = this.climate;
    if (w === 'ice') { if (c.iceTarget === 0) this.startIceAge(); return; }
    c.weather = w; c.weatherUntil = this.t + 60;
    this.log(w === 'rain' ? '雨が降り始めた' : w === 'drought' ? '干ばつが始まった' : '天気が晴れた', 'env');
  }
  tempAt(x, z) { return this.climate.temp - 0.55 * Math.max(0, this.heightAt(x, z) - this.climate.baseWater); }
  meanTempAt(x, z) { return this.climate.meanTemp - 0.55 * Math.max(0, this.heightAt(x, z) - this.climate.baseWater); }

  // ---------------- 地形 ----------------
  initTerrain() {
    const N = CFG.GRID, S = CFG.WORLD, nz = this.noise, rng = this.rng;
    this.H = new Float32Array((N + 1) * (N + 1));
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
      this.H[i * (N + 1) + j] = h;
    }
    this.hotspots = [];
  }
  buildTerrainCollider() {
    const R = this.R, N = CFG.GRID, S = CFG.WORLD;
    if (this.terrainCol) this.world.removeCollider(this.terrainCol, false);
    this.terrainCol = this.world.createCollider(R.ColliderDesc.heightfield(N, N, this.H, { x: S, y: 1, z: S }).setFriction(1.0));
    this.colliderOwner.set(this.terrainCol.handle, { kind: 't' });
    if (!this.walls) {
      this.walls = [];
      const hw = S / 2;
      for (const [x, z, sx, sz] of [[hw + 1, 0, 1, hw], [-hw - 1, 0, 1, hw], [0, hw + 1, hw, 1], [0, -hw - 1, hw, 1]]) {
        this.walls.push(this.world.createCollider(R.ColliderDesc.cuboid(sx, 60, sz).setTranslation(x, 30, z)));
      }
    }
    this.terrainVersion++;
  }
  heightAt(x, z) {
    const N = CFG.GRID, S = CFG.WORLD;
    const fx = clamp((x + S / 2) / S * N, 0, N - 1e-4), fz = clamp((z + S / 2) / S * N, 0, N - 1e-4);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, H = this.H, W = N + 1;
    // 三角形分割に合わせず双線形で近似
    return (H[i * W + j] * (1 - u) + H[(i + 1) * W + j] * u) * (1 - v) + (H[i * W + j + 1] * (1 - u) + H[(i + 1) * W + j + 1] * u) * v;
  }
  isWater(x, z) { return this.heightAt(x, z) < this.climate.water; }
  updateTerrain() {
    // 隆起と侵食（数秒ごと）
    const N = CFG.GRID, S = CFG.WORLD, W = N + 1, H = this.H, rng = this.rng;
    if (this.hotspots.length < 2 && rng() < 0.08) {
      const hs = { x: rng.range(-EDGE, EDGE), z: rng.range(-EDGE, EDGE), r: rng.range(8, 18), rate: rng.range(0.006, 0.016) * (rng() < 0.75 ? 1 : -1), until: this.t + CFG.YEAR * rng.range(1, 3), vx: rng.gauss() * 0.01, vz: rng.gauss() * 0.01 };
      this.hotspots.push(hs);
      this.log(hs.rate > 0 ? '地殻が隆起を始めた' : '大地が沈降を始めた', 'env');
    }
    this.hotspots = this.hotspots.filter(h => h.until > this.t);
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
    const talus = 0.9, k = 0.01 + 0.03 * this.climate.humidity;
    for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
      const id = i * W + j, h = H[id];
      for (const nb of [id + 1, id - 1, id + W, id - W]) {
        const dh = h - H[nb];
        if (dh > talus) { const m = (dh - talus) * k; D[id] -= m; D[nb] += m; }
      }
    }
    let maxd = 0;
    for (let i = 0; i < H.length; i++) { const d = clamp(D[i], -0.04, 0.04); H[i] = clamp(H[i] + d, -8, 40); maxd = Math.max(maxd, Math.abs(d)); }
    if (maxd > 1e-4) this.buildTerrainCollider();
  }
  computeMoisture() {
    // 水域からの距離（チャンファー距離変換）
    const N = CFG.GRID, W = N + 1, H = this.H, cell = CFG.WORLD / N, wl = this.climate.water;
    const D = this.distWater || (this.distWater = new Float32Array(W * W));
    for (let i = 0; i < D.length; i++) D[i] = H[i] < wl ? 0 : 1e9;
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
  moistureAt(x, z) {
    const N = CFG.GRID, S = CFG.WORLD, W = N + 1;
    const i = clamp(Math.round((x + S / 2) / S * N), 0, N), j = clamp(Math.round((z + S / 2) / S * N), 0, N);
    const d = this.distWater[i * W + j];
    const h = this.H[i * W + j] - this.climate.water;
    return sat(0.15 + 0.5 * this.climate.humidity + 0.55 * Math.exp(-d / 10) - Math.max(0, h - 8) * 0.015);
  }
  suitability(sp, x, z, mean = true) {
    const h = this.heightAt(x, z), wl = this.climate.water;
    if (sp.wet) { if (h < wl - 0.6 || h > wl + 2.5) return 0; }
    else if (h < wl + 0.05) return 0;
    const T = mean ? this.meanTempAt(x, z) * 0.6 + this.tempAt(x, z) * 0.4 : this.tempAt(x, z);
    return fit(T, sp.temp, 5) * fit(this.moistureAt(x, z), sp.moist, 0.15);
  }

  // ---------------- 植物 ----------------
  initPlants() {
    this.plantGrid = new Map();
    for (let k = 0; k < 8000 && this.plants.length < 1400; k++) {
      const x = this.rng.range(-EDGE, EDGE), z = this.rng.range(-EDGE, EDGE);
      this.trySeed(x, z, null, 0.75);
    }
  }
  pgKey(x, z) { return (Math.floor((x + 100) / 4) << 8) | Math.floor((z + 100) / 4); }
  plantDensity(x, z) { return this.plantGrid.get(this.pgKey(x, z))?.length || 0; }
  trySeed(x, z, sp, energyFrac = 0.2) {
    if (Math.abs(x) > EDGE + 1 || Math.abs(z) > EDGE + 1) return null;
    if (this.plants.length >= CFG.MAX_PLANTS) return null;
    if (!sp) {
      // その場所に最も適した種（多少ランダム）
      let best = null, bs = 0;
      for (const s of PLANT_SPECIES) { const v = this.suitability(s, x, z) * (0.6 + 0.8 * this.rng()); if (v > bs) { bs = v; best = s; } }
      sp = best;
    }
    if (!sp) return null;
    const s = this.suitability(sp, x, z);
    if (s < 0.3) return null;
    const cap = sp.hh > 1 ? 2 : 5;
    if (this.plantDensity(x, z) >= cap) return null;
    return this.addPlant(sp, x, z, energyFrac);
  }
  addPlant(sp, x, z, energyFrac) {
    const R = this.R, rng = this.rng;
    const size = rng.range(0.75, 1.3);
    const y = this.heightAt(x, z);
    const p = {
      id: rng() * 1e9 | 0, sp, spIdx: PLANT_SPECIES.indexOf(sp), x, z, y, size,
      maxE: sp.maxE * size * size, energy: 0, age: 0, rot: rng() * Math.PI * 2,
      shapeSeed: rng(), life: sp.life * rng.range(0.7, 1.3), alive: true,
    };
    p.energy = p.maxE * energyFrac;
    const hh = sp.hh * size;
    const desc = R.ColliderDesc.cylinder(hh, sp.col * size).setTranslation(x, y + hh - 0.05, z).setFriction(0.8);
    if (sp.soft) desc.setSensor(true).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    else desc.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(0);
    p.col = this.world.createCollider(desc);
    this.colliderOwner.set(p.col.handle, { kind: 'p', obj: p });
    this.plants.push(p);
    const key = this.pgKey(x, z);
    (this.plantGrid.get(key) || this.plantGrid.set(key, []).get(key)).push(p);
    this.plantVersion++;
    return p;
  }
  removePlant(p) {
    if (!p.alive) return;
    p.alive = false;
    this.colliderOwner.delete(p.col.handle);
    this.world.removeCollider(p.col, false);
    const arr = this.plantGrid.get(this.pgKey(p.x, p.z));
    if (arr) { const i = arr.indexOf(p); if (i >= 0) arr.splice(i, 1); }
    this.plantVersion++;
  }
  updatePlants(dt) {
    // dt は呼び出し間隔（約1秒）
    const rng = this.rng, wl = this.climate.water;
    const season = this.climate.temp;
    for (const p of this.plants) {
      if (!p.alive) continue;
      p.age += dt;
      const sNow = this.suitability(p.sp, p.x, p.z, false);
      const sMean = this.suitability(p.sp, p.x, p.z, true);
      // 地形変化で地面の高さが変わったら追従
      const ny = this.heightAt(p.x, p.z);
      if (Math.abs(ny - p.y) > 0.05) { p.y = ny; const hh = p.sp.hh * p.size; p.col.setTranslation({ x: p.x, y: ny + hh - 0.05, z: p.z }); }
      if (p.health === undefined) p.health = 1;
      if (!p.sp.wet && ny < wl - 0.1) p.health -= 0.1 * dt;
      if (sMean < 0.15) p.health -= 0.025 * dt;
      else if (p.health < 1) p.health = Math.min(1, p.health + 0.01 * dt);
      if (p.age > p.life) p.health -= 0.03 * dt;
      if (!(p.dormant > this.t)) p.energy += p.maxE * 0.035 * p.sp.grow * sNow * dt * (season < 0 ? 0.2 : 1);
      if (p.energy > p.maxE) p.energy = p.maxE;
      if (p.health <= 0 || (!p.sp.soft && p.energy <= 0)) { this.removePlant(p); continue; }
      if (p.energy > p.maxE * 0.6 && rng() < p.sp.rate * dt * sNow) {
        const a = rng() * Math.PI * 2, d = rng.range(1, p.sp.spread);
        const sp = rng() < 0.96 ? p.sp : null;
        if (this.trySeed(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, sp, 0.15)) p.energy -= p.maxE * 0.08;
      }
    }
    if (this.plants.some(p => !p.alive)) this.plants = this.plants.filter(p => p.alive);
    // 遠方からの種子（再定着）
    for (let k = 0; k < 5; k++) this.trySeed(rng.range(-EDGE, EDGE), rng.range(-EDGE, EDGE), null, 0.2);
  }

  // ---------------- 生物 ----------------
  // 共通祖先をもつ小集団を出現させる（出会いと交配の機会を確保）
  spawnFounderGroup(n) {
    const g = this.evolvedFounder();
    const sp = this.newSpecies(g, null);
    for (let tries = 0; tries < 40; tries++) {
      const x = this.rng.range(-EDGE + 10, EDGE - 10), z = this.rng.range(-EDGE + 10, EDGE - 10);
      if (this.isWater(x, z) || this.heightAt(x, z) > 12) continue;
      let first = null;
      for (let k = 0; k < n; k++) {
        // 創始集団にも少しの遺伝的多様性がある
        const gk = cloneGenome(g);
        if (k) { mutate(gk, this.rng, 0.5); for (let m = 0; m < 3; m++) gk.marks[this.rng.int(0, NMARK - 1)] = newAllele(); }
        const a = this.rng() * Math.PI * 2, d = this.rng.range(1, 5);
        const xx = x + Math.cos(a) * d, zz = z + Math.sin(a) * d;
        if (this.isWater(xx, zz)) continue;
        const c = this.spawnCreature(gk, xx, zz, { species: sp, gen: 0, energyFrac: 0.75 });
        first = first || c;
      }
      return first;
    }
    return null;
  }
  newSpecies(genome, parentSp, quiet = false) {
    const id = this.nextSpeciesId++;
    const sp = { id, parent: parentSp ? parentSp.id : null, rep: cloneGenome(genome), born: this.t, extinct: null, count: 0, peak: 0, total: 0, hue: genome.hue, name: speciesName(this.rng), depth: parentSp ? parentSp.depth + 1 : 0 };
    this.species.set(id, sp);
    if (parentSp && !quiet) this.log(`新種「${sp.name}」が「${parentSp.name}」から分岐した`, 'species');
    return sp;
  }
  // ボディ（剛体・関節）を構築する。groundFn(x,z) で地面高さを与える
  buildBody(world, genome, x, z, groundFn, yaw, lift = 0) {
    const R = this.R, parts = genome.parts;
    const tf = [];
    let q0 = qAxis({ x: 0, y: 0, z: 1 }, Math.PI / 2); // 根を横倒し
    q0 = qMul(qAxis({ x: 0, y: 1, z: 0 }, yaw), q0);
    tf[0] = { q: q0, p: { x: 0, y: 0, z: 0 } };
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i], par = parts[p.parent], pt = tf[p.parent];
      const ax = { x: Math.cos(p.az), y: 0, z: Math.sin(p.az) };
      const q = qMul(pt.q, qAxis(ax, p.a0));
      const anchorP = qRot(pt.q, { x: 0, y: p.t * par.len / 2, z: 0 });
      const anchorC = qRot(q, { x: 0, y: -p.len / 2, z: 0 });
      tf[i] = { q, p: { x: pt.p.x + anchorP.x - anchorC.x, y: pt.p.y + anchorP.y - anchorC.y, z: pt.p.z + anchorP.z - anchorC.z } };
    }
    let minY = Infinity, ground = -Infinity;
    for (let i = 0; i < parts.length; i++) {
      const up = qRot(tf[i].q, { x: 0, y: parts[i].len / 2, z: 0 });
      minY = Math.min(minY, tf[i].p.y - Math.abs(up.y) - parts[i].r);
      ground = Math.max(ground, groundFn(x + tf[i].p.x, z + tf[i].p.z));
    }
    const dy = ground - minY + 0.15 + lift;
    const bodies = [], cols = [], joints = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const b = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x + tf[i].p.x, tf[i].p.y + dy, z + tf[i].p.z)
        .setRotation(tf[i].q).setCanSleep(false).setLinearDamping(0.1).setAngularDamping(0.3));
      const col = world.createCollider(R.ColliderDesc.cylinder(p.len / 2, p.r).setDensity(CFG.DENSITY).setFriction(1.0)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS | R.ActiveEvents.COLLISION_EVENTS).setContactForceEventThreshold(0)
        .setActiveHooks(R.ActiveHooks.FILTER_CONTACT_PAIRS), b);
      bodies.push(b); cols.push(col);
    }
    const sub = parts.map((p, i) => bodies[i].mass());
    for (let i = parts.length - 1; i > 0; i--) sub[parts[i].parent] += sub[i];
    const total = sub[0];
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i], par = parts[p.parent];
      const ax = { x: Math.cos(p.az), y: 0, z: Math.sin(p.az) };
      const jd = R.JointData.revolute({ x: 0, y: p.t * par.len / 2, z: 0 }, { x: 0, y: -p.len / 2, z: 0 }, ax);
      const j = world.createImpulseJoint(jd, bodies[p.parent], bodies[i], true);
      j.setContactsEnabled(false);
      j.setLimits(p.a0 - p.range, p.a0 + p.range);
      j.configureMotorModel(R.MotorModel.ForceBased);
      j.stiff = p.str * (sub[i] + total * 0.3) * (p.len + 0.3) * 60 + 2;
      j.damp = j.stiff * 0.01;
      j.ax = ax;
      // 体の左右どちら側にある体節か（根の円柱から見た横方向の位置）。曲がるときは片側の動きを強める
      const loc = qRot(qConj(q0), tf[i].p);
      j.side = clamp(loc.z / 0.6, -1, 1);
      j.configureMotorPosition(p.a0, j.stiff, j.damp);
      joints.push(j);
    }
    return { bodies, cols, joints };
  }
  makeCreatureState(genome, opts) {
    const st = genomeStats(genome);
    return {
      id: this.nextCreatureId++, genome, species: opts.species, gen: opts.gen || 0,
      parents: opts.parents || null, born: this.t, age: 0, alive: true, dead: false, deadAt: 0,
      vol: st.vol, area: st.area, nParts: genome.parts.length,
      maxE: 500 * st.vol + 60, energy: 0, children: 0, kills: 0, eaten: 0,
      bodies: [], cols: [], joints: [], phase: this.rng() * 6.28, mem: new Float32Array(NMEM),
      hidden: new Float32Array(NH), out: new Float32Array(NO), inp: new Float32Array(NI),
      angles: new Float32Array(MAXJ),
      lastMate: this.t, hurt: 0, ate: 0, sense: null, mutations: opts.mutations || [],
      cost: { base: 0, move: 0, climate: 0, water: 0 },
    };
  }
  spawnCreature(genome, x, z, opts = {}) {
    const c = this.makeCreatureState(genome, opts);
    c.energy = c.maxE * (opts.energyFrac ?? 0.6);
    if (opts.energy !== undefined) c.energy = Math.min(c.maxE, opts.energy);
    const yaw = opts.yaw ?? this.rng() * Math.PI * 2;
    const body = this.buildBody(this.world, genome, x, z, (a, b) => this.heightAt(a, b), yaw, opts.lift || 0);
    Object.assign(c, body);
    body.cols.forEach((col, i) => this.colliderOwner.set(col.handle, { kind: 'c', obj: c, part: i }));
    if (c.species) { c.species.count++; c.species.total++; c.species.peak = Math.max(c.species.peak, c.species.count); }
    this.creatures.push(c);
    return c;
  }
  // 平地での試走距離（祖先選抜用）
  trialDistance(genome, secs = 8) {
    const R = this.R;
    const w = new R.World({ x: 0, y: -9.81, z: 0 }); w.timestep = CFG.DT;
    w.createCollider(R.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0).setFriction(1.0));
    const c = this.makeCreatureState(genome, {});
    this.nextCreatureId--;
    Object.assign(c, this.buildBody(w, genome, 0, 0, () => 0, 0));
    const rs = () => this.rng.range(-1, 1);
    c.sense = { ps: rs(), pc: rs(), pp: this.rng(), cs: rs(), cc: rs(), cp: this.rng() * 0.5, kin: rs(), size: rs() * 0.5, waterAhead: 0, slope: 0, temp: rs() * 0.5, up: 0 };
    c.energy = c.maxE * 0.5;
    const n = secs / CFG.DT;
    let p0 = null, flips = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < c.joints.length; j++) c.angles[j] = this.jointAngle(c, j);
      this.think(c, CFG.DT);
      this.driveMotors(c);
      w.step();
      this.clampVel(c);
      if (i === 40) p0 = c.bodies[0].translation();
    }
    const p1 = c.bodies[0].translation();
    const d = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const bad = !isFinite(d) || p1.y > 5;
    w.free();
    return bad ? 0 : d;
  }
  // 試走で選んだ祖先ゲノム
  // 平地での試走：感覚で示した目標方向へどれだけ近づけるか（祖先の事前選抜用）
  trialSteer(genome, phases = 4, secs = 3.5) {
    const R = this.R;
    const w = new R.World({ x: 0, y: -9.81, z: 0 }); w.timestep = CFG.DT;
    w.createCollider(R.ColliderDesc.cuboid(80, 0.5, 80).setTranslation(0, -0.5, 0).setFriction(1.0));
    const c = this.makeCreatureState(genome, {});
    this.nextCreatureId--;
    Object.assign(c, this.buildBody(w, genome, 0, 0, () => 0, this.rng() * 6.28));
    c.energy = c.maxE * 0.6;
    const s = c.sense = { ps: 0, pc: 0, pp: 0, cs: 0, cc: 0, cp: 0, kin: 1, size: 0, waterAhead: 0, slope: 0, temp: 0, up: 0 };
    let score = 0, settle = 30;
    for (let i = 0; i < settle; i++) { for (let j = 0; j < c.joints.length; j++) c.angles[j] = this.jointAngle(c, j); this.think(c, CFG.DT); this.driveMotors(c); w.step(); this.clampVel(c); }
    for (let ph = 0; ph < phases; ph++) {
      const p0 = c.bodies[0].translation();
      const a = this.rng() * Math.PI * 2;
      const tx = p0.x + Math.cos(a) * 12, tz = p0.z + Math.sin(a) * 12;
      const useFood = true;
      for (let i = 0; i < secs / CFG.DT; i++) {
        if (i % 4 === 0) {
          const pos = c.bodies[0].translation(), q = c.bodies[0].rotation();
          const hd = this.travelDir(c, q), fx = hd.x, fz = hd.z;
          const dx = tx - pos.x, dz = tz - pos.z, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
          const si = fx * uz - fz * ux, co = fx * ux + fz * uz, pr = Math.max(0.05, 1 - l / CFG.SENSE_R);
          s.ps = useFood ? si : 0; s.pc = useFood ? co : 0; s.pp = useFood ? pr : 0;
          s.cs = useFood ? 0 : si; s.cc = useFood ? 0 : co; s.cp = useFood ? 0 : pr;
          s.up = qRot(q, { x: 0, y: 0, z: 1 }).y;
        }
        for (let j = 0; j < c.joints.length; j++) c.angles[j] = this.jointAngle(c, j);
        this.think(c, CFG.DT);
        this.driveMotors(c);
        w.step();
        this.clampVel(c);
      }
      const p1 = c.bodies[0].translation();
      const d0 = Math.hypot(tx - p0.x, tz - p0.z), d1 = Math.hypot(tx - p1.x, tz - p1.z);
      if (!isFinite(d1)) { score = -99; break; }
      score += d0 - d1;
    }
    w.free();
    return score;
  }
  // 祖先は「平地をどれだけ進めるか」で短い事前進化をさせて用意する
  evolvedFounder(pop = 10, gens = 4) {
    // 目標（食べ物）へ近づけた距離を主に、まっすぐ進む力も少し評価する
    const score = (g) => this.trialDistance(g, 6) / (0.6 + Math.sqrt(genomeStats(g).vol));
    let cands = [];
    for (let i = 0; i < pop; i++) { const g = randomGenome(this.rng); cands.push({ g, f: score(g) }); }
    for (let gen = 1; gen < gens; gen++) {
      cands.sort((x, y) => y.f - x.f);
      const elite = cands.slice(0, 3);
      cands = elite.slice();
      while (cands.length < pop) {
        const p = this.rng.pick(elite), g = cloneGenome(p.g);
        g.marks = p.g.marks.slice();
        mutate(g, this.rng, 2);
        cands.push({ g, f: score(g) });
      }
    }
    cands.sort((x, y) => y.f - x.f);
    // 走性の向き（右に曲がるか左に曲がるか）は体のつくり次第なので、試して合う向きを選ぶ
    const g = cands[0].g;
    let bestT = 0, bestS = -Infinity;
    for (const tx of [-2, 0, 2]) { g.taxis = tx; const sc = this.trialSteer(g, 4, 4) + this.trialSteer(g, 4, 4); if (sc > bestS) { bestS = sc; bestT = tx; } }
    g.taxis = bestT + this.rng.gauss() * 0.3;
    return g;
  }



  jointAngle(c, ji) {
    const p = c.genome.parts[ji + 1];
    const qp = c.bodies[p.parent].rotation(), qc = c.bodies[ji + 1].rotation();
    const q = qMul(qConj(qp), qc), ax = c.joints[ji].ax;
    return 2 * Math.atan2(q.x * ax.x + q.y * ax.y + q.z * ax.z, q.w);
  }
  kill(c, cause) {
    if (c.dead) return;
    c.dead = true; c.deadAt = this.t; c.cause = cause;
    c.corpseE = Math.max(c.energy, 0) + c.maxE * 0.35;
    c.energy = 0;
    for (const j of c.joints) j.configureMotorPosition(0, 0, 0.5);
    for (const b of c.bodies) b.setAngularDamping(2);
    this.counters.deaths++;
    const sp = c.species;
    if (sp) {
      sp.count--;
      if (sp.count <= 0 && !this.creatures.some(o => o.alive && !o.dead && o.species === sp)) {
        sp.extinct = this.t;
        this.log(`種「${sp.name}」が絶滅した`, 'extinct');
      }
    }
  }
  removeCreature(c) {
    c.alive = false;
    for (const col of c.cols) this.colliderOwner.delete(col.handle);
    for (const b of c.bodies) this.world.removeRigidBody(b);
    c.bodies = []; c.cols = []; c.joints = [];
  }
  center(c) {
    const t = c.bodies[0].translation(); return t;
  }

  // 進行方向：実際に進んでいる向き（速度の移動平均）。ほぼ止まっているときは体の向き
  travelDir(c, q) {
    // 歩行のゆれを均すため、約2秒分の移動を平均する
    const v = c.bodies[0].linvel();
    const k = 0.08;
    c.vx = (c.vx || 0) * (1 - k) + v.x * k; c.vz = (c.vz || 0) * (1 - k) + v.z * k;
    const sp = Math.hypot(c.vx, c.vz);
    if (sp > 0.08) return { x: c.vx / sp, z: c.vz / sp };
    return this.heading(q);
  }
  // 根の円柱の長軸（転がっても変わらない）を水平に射影した向き
  heading(q) {
    let f = qRot(q, { x: 0, y: 1, z: 0 });
    let l = Math.hypot(f.x, f.z);
    if (l < 0.2) { f = qRot(q, { x: 1, y: 0, z: 0 }); l = Math.hypot(f.x, f.z) || 1; }
    return { x: f.x / l, z: f.z / l };
  }
  // 生物の位置の空間グリッド（1ステップに1回だけ作る）
  creatureGrid() {
    if (this._cgStep === this.stepCount) return this._cg;
    const G = new Map();
    for (const o of this.creatures) {
      if (!o.alive || !o.bodies[0]) continue;
      const t = o.bodies[0].translation();
      const k = (Math.floor((t.x + 100) / 8) << 8) | Math.floor((t.z + 100) / 8);
      (G.get(k) || G.set(k, []).get(k)).push({ c: o, x: t.x, z: t.z });
    }
    this._cg = G; this._cgStep = this.stepCount;
    return G;
  }
  // 感覚と脳
  sense(c) {
    const pos = this.center(c), R = CFG.SENSE_R;
    const q = c.bodies[0].rotation();
    const f = this.travelDir(c, q);
    // 最寄りの植物
    let bp = null, bd = R * R;
    const k0 = Math.floor((pos.x + 100) / 4), k1 = Math.floor((pos.z + 100) / 4), rr = Math.ceil(R / 4);
    for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) {
      const arr = this.plantGrid.get(((k0 + a) << 8) | (k1 + b)); if (!arr) continue;
      for (const p of arr) {
        // 食べられる状態の植物だけを感じ取る（食べ尽くされて回復待ちの草は無視）
        if (p.sp.soft ? (p.dormant > this.t || p.energy < p.maxE * (CFG.GRAZE_FLOOR + 0.15)) : p.energy < 1) continue;
        const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2; if (d < bd) { bd = d; bp = p; }
      }
    }
    // 最寄りの生物（死骸含む）
    let bc = null, cd = R * R, bcx = 0, bcz = 0;
    const G = this.creatureGrid(), gx = Math.floor((pos.x + 100) / 8), gz = Math.floor((pos.z + 100) / 8), gr = Math.ceil(R / 8);
    for (let a = -gr; a <= gr; a++) for (let b = -gr; b <= gr; b++) {
      const arr = G.get(((gx + a) << 8) | (gz + b)); if (!arr) continue;
      for (const o of arr) {
        if (o.c === c || !o.c.alive) continue;
        const d = (o.x - pos.x) ** 2 + (o.z - pos.z) ** 2;
        if (d < cd) { cd = d; bc = o.c; bcx = o.x; bcz = o.z; }
      }
    }
    const rel = (tx, tz) => { const dx = tx - pos.x, dz = tz - pos.z, l = Math.hypot(dx, dz) || 1; const ux = dx / l, uz = dz / l; return [f.x * uz - f.z * ux, f.x * ux + f.z * uz]; };
    const s = c.sense || (c.sense = {});
    s.plant = bp; s.other = bc;
    if (bp) { [s.ps, s.pc] = rel(bp.x, bp.z); s.pp = 1 - Math.sqrt(bd) / R; } else { s.ps = 0; s.pc = 0; s.pp = 0; }
    if (bc) {
      [s.cs, s.cc] = rel(bcx, bcz); s.cp = 1 - Math.sqrt(cd) / R;
      s.kin = bc.dead ? -1 : compatibility(c.genome, bc.genome) * 2 - 1;
      s.size = clamp(Math.log((bc.vol + 0.01) / (c.vol + 0.01)), -2, 2) / 2;
    } else { s.cs = s.cc = s.cp = s.kin = s.size = 0; }
    const ax = pos.x + f.x * 2.5, az = pos.z + f.z * 2.5;
    s.waterAhead = this.isWater(ax, az) ? 1 : 0;
    s.slope = clamp((this.heightAt(ax, az) - this.heightAt(pos.x, pos.z)) / 2.5, -1, 1);
    s.temp = clamp((this.tempAt(pos.x, pos.z) - 15) / 15, -1.5, 1.5);
    s.up = qRot(q, { x: 0, y: 0, z: 1 }).y;
  }
  think(c, dt) {
    c.phase += c.genome.freq * dt * Math.PI * 2;
    const s = c.sense, I = c.inp;
    I[0] = 1; I[1] = Math.sin(c.phase); I[2] = Math.cos(c.phase); I[3] = c.energy / c.maxE * 2 - 1;
    I[4] = s.ps; I[5] = s.pc; I[6] = s.pp; I[7] = s.cs; I[8] = s.cc; I[9] = s.cp; I[10] = s.kin; I[11] = s.size;
    I[12] = s.waterAhead; I[13] = s.slope; I[14] = s.temp; I[15] = s.up; I[16] = c.ate > 0 ? 1 : 0; I[17] = c.hurt > 0 ? 1 : 0;
    const nj = c.joints.length, parts = c.genome.parts;
    for (let j = 0; j < MAXJ; j++) I[18 + j] = j < nj ? clamp((c.angles[j] - parts[j + 1].a0) / (parts[j + 1].range + 1e-3), -1.5, 1.5) : 0;
    for (let m = 0; m < NMEM; m++) I[18 + MAXJ + m] = c.mem[m];
    const B = c.genome.brain, Hh = c.hidden, O = c.out;
    for (let h = 0; h < NH; h++) {
      let a = B[NW1 + h];
      for (let i = 0; i < NI; i++) a += I[i] * B[i * NH + h];
      Hh[h] = Math.tanh(a);
    }
    const o2 = NW1 + NH, ob = o2 + NW2;
    for (let o = 0; o < NO; o++) {
      let a = B[ob + o];
      for (let h = 0; h < NH; h++) a += Hh[h] * B[o2 + h * NO + o];
      O[o] = Math.tanh(a);
    }
    for (let m = 0; m < NMEM; m++) c.mem[m] = O[MAXJ + m];
  }

  clampVel(c) {
    for (const b of c.bodies) {
      const v = b.linvel(), s = Math.hypot(v.x, v.y, v.z);
      if (s > 12) b.setLinvel({ x: v.x * 12 / s, y: v.y * 12 / s, z: v.z * 12 / s }, true);
      const w = b.angvel(), ws = Math.hypot(w.x, w.y, w.z);
      if (ws > 25) b.setAngvel({ x: w.x * 25 / ws, y: w.y * 25 / ws, z: w.z * 25 / ws }, true);
    }
  }
  driveMotors(c) {
    const parts = c.genome.parts;
    let move = 0;
    const tired = c.energy < c.maxE * 0.08 ? 0.4 : 1;
    // 生まれつきの走性：食べ物の方向へ曲がり（taxis）、食べ物がないときは歩みを速める（seek）。強さと向きは遺伝する
    const s = c.sense, g = c.genome;
    const food = s && s.pp > 0 && c.ate <= 0;
    const turn = Math.tanh(c.out[O_TURN] + (food ? (g.taxis ?? 0) * s.ps : 0));
    const go = Math.tanh(c.out[O_GO] + (g.seek ?? 0) * (c.ate > 0 ? -0.6 : 0.6));
    for (let j = 0; j < c.joints.length; j++) {
      const p = parts[j + 1], jt = c.joints[j];
      const ph = c.phase + (p.ph ?? 0);
      const amp = (p.amp ?? 1) * (0.55 + 0.45 * go) * Math.max(0, 1 + 0.9 * turn * (jt.side ?? 0));
      const tgt = p.a0 + p.range * Math.tanh(c.out[j] * 0.6 + amp * Math.sin(ph) + (p.tw ?? 0) * turn * Math.cos(ph));
      jt.configureMotorPosition(tgt, jt.stiff * tired, jt.damp);
      const b1 = c.bodies[p.parent].angvel(), b2 = c.bodies[j + 1].angvel();
      const w = Math.abs((b2.x - b1.x) * jt.ax.x + (b2.y - b1.y) * jt.ax.y + (b2.z - b1.z) * jt.ax.z);
      move += jt.stiff * tired * Math.abs(tgt - c.angles[j]) * Math.min(w, 8);
    }
    return move;
  }
  // 1ステップ
  step() {
    const dt = CFG.DT, R = this.R;
    this.t += dt; this.stepCount++;
    const sc = this.stepCount;
    if (sc % 4 === 0) this.updateClimate(dt * 4);
    if (sc % 40 === 0) this.updatePlants(1);
    if (sc % 200 === 0) { this.updateTerrain(); }
    if (sc % 120 === 0) this.computeMoisture();

    const wl = this.climate.water;
    const T = this.climate.temp;
    // 生物の制御とエネルギー
    for (let ci = 0; ci < this.creatures.length; ci++) {
      const c = this.creatures[ci];
      if (!c.alive) continue;
      if (c.dead) {
        c.corpseE -= (0.4 + c.corpseE * 0.012) * dt;
        if (c.corpseE <= 0 || this.t - c.deadAt > 40) { this.removeCreature(c); continue; }
        // 倒れて動かなくなった死骸は固定物にして物理計算を省く
        if (!c.frozen && this.t - c.deadAt > 3) { c.frozen = true; for (const b of c.bodies) b.setBodyType(this.R.RigidBodyType.Fixed, false); }
        continue;
      }
      c.age += dt;
      if (c.hurt > 0) c.hurt -= dt; if (c.ate > 0) c.ate -= dt;
      for (let j = 0; j < c.joints.length; j++) c.angles[j] = this.jointAngle(c, j);
      if (!c.sense || (sc + c.id) % 4 === 0) this.sense(c);
      this.think(c, dt);
      const move = this.driveMotors(c);
      // エネルギー消費
      const base = 0.1 + 0.65 * c.vol + 0.055 * c.nParts + 0.03 * c.joints.length;
      const mv = move * 0.0006;
      let clim = 0;
      const pos = c.bodies[0].translation();
      const lt = T - 0.55 * Math.max(0, this.heightAt(pos.x, pos.z) - this.climate.baseWater);
      if (lt < 5) clim = (5 - lt) * 0.03 * c.area;
      else if (lt > 29) clim = (lt - 29) * 0.12 * c.vol;
      let wet = 0, sub = 0;
      for (const b of c.bodies) if (b.translation().y < wl) sub++;
      if (sub) {
        wet = (2.0 + 8 * c.vol) * sub / c.bodies.length;
        for (const b of c.bodies) b.setLinearDamping(b.translation().y < wl ? 2.5 : 0.1);
      } else if (c.wasWet) for (const b of c.bodies) b.setLinearDamping(0.1);
      c.wasWet = sub > 0;
      c.cost.base = base; c.cost.move = mv; c.cost.climate = clim; c.cost.water = wet;
      c.energy -= (base + mv + clim + wet) * dt;
      if (c.energy <= 0) { this.kill(c, '飢餓'); continue; }
      if (pos.y < -20) { this.kill(c, '転落'); continue; }
      if (c.age > 600 + c.vol * 400) { this.kill(c, '寿命'); continue; }
    }

    this.world.step(this.eventQueue, this.hooks);
    if (sc % 2 === 0) for (const c of this.creatures) if (c.alive) this.clampVel(c);

    // 接触イベント処理：捕食・繁殖
    const owner = this.colliderOwner;
    const pairs = [];
    this.eventQueue.drainContactForceEvents(ev => {
      const a = owner.get(ev.collider1()), b = owner.get(ev.collider2());
      if (!a || !b) return;
      if (a.kind === 't' || b.kind === 't') return;
      pairs.push([a, b, ev.totalForceMagnitude()]);
    });
    for (const [a, b, F] of pairs) this.handleContact(a, b, F, dt);
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      const a = owner.get(h1), b = owner.get(h2);
      if (!a || !b) return;
      const pl = a.kind === 'p' ? a : b.kind === 'p' ? b : null, cr = a.kind === 'c' ? a : b.kind === 'c' ? b : null;
      if (!pl || !cr) return;
      const key = h1 < h2 ? h1 + ':' + h2 : h2 + ':' + h1;
      if (started) this.grazing.set(key, { p: pl.obj, c: cr }); else this.grazing.delete(key);
    });
    for (const [key, g] of this.grazing) {
      const p = g.p, cr = g.c.obj;
      if (!p.alive || !cr.alive || cr.dead) { this.grazing.delete(key); continue; }
      const body = cr.bodies[g.c.part]; if (!body) { this.grazing.delete(key); continue; }
      const v = body.linvel(), spd = Math.hypot(v.x, v.y, v.z);
      // 勢いよく触れるほど多く食べられる。食べ尽くした草はしばらく回復せず、次の草場へ移る必要がある
      if (p.dormant > this.t) continue;
      const floor = p.maxE * CFG.GRAZE_FLOOR;
      const dmg = Math.min(Math.max(0, p.energy - floor), (4 + body.mass() * spd * 0.5) * dt);
      if (dmg <= 0) continue;
      p.energy -= dmg;
      if (p.energy <= floor + 0.01) p.dormant = this.t + this.rng.range(...CFG.RECOVER);
      const gain = dmg * 0.85 * CFG.FOOD_GAIN;
      cr.energy = Math.min(cr.maxE, cr.energy + gain); cr.eaten += gain; cr.ate = 0.5;
    }
    this.eventQueue.clear?.();

    if (sc % 80 === 0) this.housekeeping();
    if (sc % 400 === 200) this.updateSpecies();
    if (sc % 80 === 0) this.recordStats();
  }

  handleContact(a, b, F, dt) {
    if (a.kind === 'p' || b.kind === 'p') {
      const c = a.kind === 'c' ? a : b, p = (a.kind === 'p' ? a : b).obj;
      const cr = c.obj; if (!cr || cr.dead || !p.alive) return;
      const body = cr.bodies[c.part]; if (!body) return;
      const m = body.mass();
      const v = body.linvel(), sp = Math.hypot(v.x, v.y, v.z);
      const eff = Math.max(0, F - m * 9.81 * 1.2) + m * sp * 6;
      // 木の葉は高い位置に届く体の部分なら食べやすい。低い位置は幹に体当たりして少しずつ削るしかない
      const high = body.translation().y - p.y > CFG.CANOPY * p.size;
      const dmg = Math.min(p.energy, (high ? 5.0 + eff * 0.02 : eff * 0.015) * dt);
      if (dmg <= 0) return;
      p.energy -= dmg;
      const gain = dmg * 0.85 * CFG.FOOD_GAIN;
      cr.energy = Math.min(cr.maxE, cr.energy + gain); cr.eaten += gain; cr.ate = 0.5;
      if (p.energy <= 0.01) this.removePlant(p);
      return;
    }
    if (a.kind !== 'c' || b.kind !== 'c') return;
    const A = a.obj, B = b.obj;
    if (!A.alive || !B.alive || A === B) return;
    const ba = A.bodies[a.part], bb = B.bodies[b.part];
    if (!ba || !bb) return;
    const va = ba.linvel(), vb = bb.linvel();
    const sa = Math.hypot(va.x, va.y, va.z), sb = Math.hypot(vb.x, vb.y, vb.z);
    // 繁殖
    if (!A.dead && !B.dead) this.tryMate(A, B);
    // 衝突によるダメージ（速い側が攻撃側）
    const ma = ba.mass(), mb = bb.mass();
    const base = Math.max(0, F - (ma + mb) * 9.81 * 0.8);
    // 一定以上の速さでぶつかった側が相手を削る（衝突の強さ × 速さ）
    const k = 0.02 * dt;
    const hitA = base * k * Math.max(0, sa - 0.9) * (sa * sa) / (sa * sa + sb * sb + 0.05); // A が B に与える
    const hitB = base * k * Math.max(0, sb - 0.9) * (sb * sb) / (sa * sa + sb * sb + 0.05);
    this.applyHit(A, B, hitA);
    this.applyHit(B, A, hitB);
  }
  applyHit(att, tgt, dmg) {
    if (att.dead || dmg <= 0.001) return;
    if (tgt.dead) {
      const d = Math.min(tgt.corpseE, dmg * 1.5);
      tgt.corpseE -= d; att.energy = Math.min(att.maxE, att.energy + d * 0.8 * CFG.FOOD_GAIN); att.eaten += d * 0.8 * CFG.FOOD_GAIN; att.ate = 0.5;
      return;
    }
    const d = Math.min(tgt.energy, dmg);
    tgt.energy -= d; tgt.hurt = 0.5;
    att.energy = Math.min(att.maxE, att.energy + d * 0.7 * CFG.FOOD_GAIN); att.eaten += d * 0.7 * CFG.FOOD_GAIN; att.ate = 0.5;
    if (tgt.energy <= 0) { this.kill(tgt, `捕食（${att.species?.name || '?'}）`); att.kills++; this.counters.predations++; }
  }
  tryMate(A, B) {
    const t = this.t;
    if (t - A.lastMate < 8 || t - B.lastMate < 8 || A.age < 6 || B.age < 6) return;
    if (A.energy < A.maxE * CFG.MATE_E || B.energy < B.maxE * CFG.MATE_E) return;
    if (this.livingCount() > CFG.MAX_POP - CFG.MAX_LITTER) return; // 子を育てる余地がない
    const rng = this.rng;
    const key = A.id < B.id ? A.id + ':' + B.id : B.id + ':' + A.id;
    if ((this.rejectUntil.get(key) || 0) > t) return;
    // 交配前の隔離：互いを配偶相手と認めるか（体色と選り好み）
    if (rng() > recognizes(A.genome, B.genome) * recognizes(B.genome, A.genome)) {
      this.rejectUntil.set(key, t + 15); this.counters.rejected++; return;
    }
    const compat = compatibility(A.genome, B.genome);
    // 両親が差し出したエネルギーの総量で子の数が決まる
    const ca = A.energy * CFG.INVEST, cb = B.energy * CFG.INVEST;
    A.energy -= ca; B.energy -= cb; A.lastMate = t; B.lastMate = t;
    // 交配行動そのものにもエネルギーを使い、その分は子に回らない
    let pool = Math.max(0, ca + cb - CFG.MATE_COST * (A.maxE + B.maxE));
    const pa = this.center(A), pb = this.center(B);
    const mx = (pa.x + pb.x) / 2, mz = (pa.z + pb.z) / 2;
    const born = [];
    let stillborn = 0;
    for (let k = 0; k < CFG.MAX_LITTER; k++) {
      const g = recombine(A.genome, B.genome, rng);
      const muts = mutate(g, rng);
      const st = genomeStats(g);
      const cost = CFG.CHILD_COST * (500 * st.vol + 60);
      // 最後の1体は残りのエネルギーに応じた確率で生まれる（期待値＝総エネルギー÷1体の費用）
      if (pool < cost && !(k > 0 && rng() < pool / cost)) break;
      const e = Math.min(pool, cost); pool -= e;
      // 交配後の隔離：系統が離れていると雑種は育たない
      if (rng() > compat) { stillborn++; continue; }
      const ang = (k / 3 + rng() * 0.3) * Math.PI * 2, d = 1.2 + k * 0.35;
      let x = clamp(mx + Math.cos(ang) * d, -EDGE, EDGE), z = clamp(mz + Math.sin(ang) * d, -EDGE, EDGE);
      const sp = this.speciesForChild(g, A, B);
      const child = this.spawnCreature(g, x, z, { species: sp, gen: Math.max(A.gen, B.gen) + 1, energy: e, parents: [A.id, B.id], lift: 0.5 + k * 0.15, mutations: muts });
      born.push(child);
    }
    // 使い切れなかった分は親へ戻る
    if (pool > 0) { A.energy = Math.min(A.maxE, A.energy + pool / 2); B.energy = Math.min(B.maxE, B.energy + pool / 2); }
    for (const c of born) c.litter = born.length;
    A.children += born.length; B.children += born.length;
    this.counters.births += born.length; this.counters.stillborn += stillborn; this.counters.matings++;
    (this.litters || (this.litters = [])).push(born.length);
    if (this.litters.length > 200) this.litters.shift();
    if (A.species !== B.species && born.length) this.log(`「${A.species.name}」と「${B.species.name}」の雑種が${born.length}体生まれた`, 'species');
    return born;
  }
  // 親と同じ種に入る。異種間の雑種は、より交配できる側の種に入る
  speciesForChild(g, A, B) {
    if (A.species === B.species) return A.species;
    const score = (sp) => {
      let s = 0, n = 0;
      for (const o of this.creatures) if (o.alive && !o.dead && o.species === sp && n < 12) { s += compatibility(g, o.genome); n++; }
      return n ? s / n : 0;
    };
    return score(A.species) >= score(B.species) ? A.species : B.species;
  }
  // 互いを配偶相手と認め、かつ雑種が育つか（交配前と交配後の両方の隔離を考える）
  interfertile(a, b) {
    return compatibility(a, b) * Math.sqrt(recognizes(a, b) * recognizes(b, a)) >= CFG.FERTILE;
  }
  // 生物学的種概念：互いに子を残せる個体のつながりを1つの種とし、つながりが切れた集団を新種として分ける
  updateSpecies() {
    const bySp = new Map();
    for (const c of this.creatures) if (c.alive && !c.dead) (bySp.get(c.species) || bySp.set(c.species, []).get(c.species)).push(c);
    for (const [sp, mem] of bySp) {
      if (mem.length < 4) continue;
      const n = mem.length, comp = new Int32Array(n).fill(-1);
      let nc = 0;
      for (let i = 0; i < n; i++) {
        if (comp[i] >= 0) continue;
        const stack = [i]; comp[i] = nc;
        while (stack.length) {
          const u = stack.pop();
          for (let v = 0; v < n; v++) if (comp[v] < 0 && this.interfertile(mem[u].genome, mem[v].genome)) { comp[v] = nc; stack.push(v); }
        }
        nc++;
      }
      if (nc < 2) continue;
      const groups = Array.from({ length: nc }, () => []);
      mem.forEach((c, i) => groups[comp[i]].push(c));
      groups.sort((a, b) => b.length - a.length);
      for (const g of groups.slice(1)) {
        if (g.length < 2) continue; // 1体だけ外れた個体は集団とみなさない
        const nsp = this.newSpecies(g[0].genome, sp, true);
        for (const c of g) { c.species = nsp; sp.count--; nsp.count++; nsp.total++; }
        nsp.peak = nsp.count;
        this.log(`「${sp.name}」の一部（${g.length}体）が生殖的に隔離され、新種「${nsp.name}」になった`, 'species');
      }
    }
    for (const [k, v] of this.rejectUntil) if (v < this.t) this.rejectUntil.delete(k);
  }
  livingCount() { let n = 0; for (const c of this.creatures) if (c.alive && !c.dead) n++; return n; }
  housekeeping() {
    this.creatures = this.creatures.filter(c => c.alive);
    const n = this.livingCount();
    if (n < CFG.MIN_POP && this.autoImmigrate !== false && this.t - (this.lastImmig || -99) > 20) {
      this.lastImmig = this.t;
      const c = this.spawnFounderGroup(CFG.GROUP);
      if (c) this.log(`個体数が減り、未知の新種「${c.species.name}」の群れが移入した`, 'info');
    }
  }
  recordStats() {
    const live = this.creatures.filter(c => c.alive && !c.dead);
    const n = live.length;
    let parts = 0, vol = 0, maxParts = 0;
    for (const c of live) { parts += c.nParts; vol += c.vol; maxParts = Math.max(maxParts, c.nParts); }
    const spAlive = new Set(live.map(c => c.species.id)).size;
    const pc = new Array(PLANT_SPECIES.length).fill(0);
    for (const p of this.plants) pc[p.spIdx]++;
    this.stats.push({
      t: this.t, pop: n, plants: this.plants.length, species: spAlive,
      parts: n ? parts / n : 0, vol: n ? vol / n : 0, maxParts,
      temp: this.climate.temp, water: this.climate.water, plantCounts: pc,
      births: this.counters.births, deaths: this.counters.deaths,
      litter: this.litters?.length ? this.litters.reduce((a, b) => a + b, 0) / this.litters.length : 0,
    });
    if (this.stats.length > 3000) this.stats = this.stats.filter((_, i) => i % 2 === 0);
  }
}
