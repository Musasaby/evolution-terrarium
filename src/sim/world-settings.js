// ===== 世界の設定：地形・土壌・気候の傾向 =====
// タイトル画面で選ぶ値を sim に渡すための定義。省略した項目は DEFAULT_SETTINGS と同じ
// （既定のときは乱数の消費順を変えないので、今までと同じ世界になる）。

import { CFG } from './config.js';

export const DEFAULT_SETTINGS = Object.freeze({
  size: 120,                       // 世界の一辺（m）80〜160
  mtnCount: null,                  // 山の数（null=シード任せの 1〜3、または 0〜5）
  mtnHeight: 1,                    // 山の高さの倍率 0.4〜1.8
  lakeCount: null,                 // 湖の数（null=シード任せの 1〜3、または 0〜4）
  lakeSize: 1,                     // 湖の面積合計の倍率 0.4〜2.0
  soil: Object.freeze([1, 1, 1, 1]), // 土壌の重み（岩場・砂地・肥沃・泥炭）各 0〜1。合計 0 は均等扱い
  tempOffset: 0,                   // 平均気温のずれ（℃）-8〜+8
  seasonAmp: 1,                    // 季節の振れ幅の倍率 0.5〜1.5
  wetness: 0,                      // 降水の傾向 -1〜1（雨・干ばつの起こりやすさ）
});

// 広さから決まる値。格子の大きさは既定（CFG.BASE_SIZE / CFG.BASE_GRID）を保ち、
// 個体数・植物数の上限は面積に比例させる（既定の広さでは今までの値のまま）
export function worldGeometry(size) {
  const area = (size / CFG.BASE_SIZE) ** 2;
  const scale = n => Math.round(n * area);
  return Object.freeze({
    size,
    grid: Math.round(size / (CFG.BASE_SIZE / CFG.BASE_GRID)),
    edge: size / 2 - 4,
    k: size / CFG.BASE_SIZE,   // 置き場所の範囲の倍率
    area,
    maxPop: scale(CFG.MAX_POP),
    minPop: scale(CFG.MIN_POP),
    maxPlants: scale(CFG.MAX_PLANTS),
    maxSoftPlants: scale(CFG.MAX_SOFT_PLANTS),
    maxHardPlants: scale(CFG.MAX_HARD_PLANTS),
    initPlants: scale(1400),
  });
}

const num = (v, lo, hi, def) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const count = (v, hi) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(Math.min(hi, Math.max(0, v))));

// 欠けた項目を既定値で埋め、範囲外をクランプした凍結済みの新しいオブジェクトを返す（引数は書き換えない）
export function normalizeSettings(partial) {
  const p = partial || {};
  const D = DEFAULT_SETTINGS;
  let soil = Array.isArray(p.soil) ? [0, 1, 2, 3].map(i => num(p.soil[i], 0, 1, 1)) : [...D.soil];
  if (soil.every(w => w === 0)) soil = [1, 1, 1, 1];
  return Object.freeze({
    size: num(p.size, 80, 160, D.size),
    mtnCount: count(p.mtnCount, 5),
    mtnHeight: num(p.mtnHeight, 0.4, 1.8, D.mtnHeight),
    lakeCount: count(p.lakeCount, 4),
    lakeSize: num(p.lakeSize, 0.4, 2.0, D.lakeSize),
    soil: Object.freeze(soil),
    tempOffset: num(p.tempOffset, -8, 8, D.tempOffset),
    seasonAmp: num(p.seasonAmp, 0.5, 1.5, D.seasonAmp),
    wetness: num(p.wetness, -1, 1, D.wetness),
  });
}

// カテゴリ別のテンプレート。各テンプレートは自分のカテゴリの項目だけを持つ
export const SETTING_PRESETS = Object.freeze({
  size: Object.freeze([
    { id: 'small', name: '狭い', desc: '一辺 90 m', values: { size: 90 } },
    { id: 'standard', name: '標準', desc: '一辺 120 m', values: { size: 120 } },
    { id: 'large', name: '広い', desc: '一辺 150 m', values: { size: 150 } },
  ]),
  terrain: Object.freeze([
    { id: 'standard', name: '標準', desc: '山と湖の数はシード任せ', values: { mtnCount: null, mtnHeight: 1, lakeCount: null, lakeSize: 1 } },
    { id: 'mountain', name: '山岳', desc: '高い山が多い', values: { mtnCount: 4, mtnHeight: 1.3, lakeCount: null, lakeSize: 1 } },
    { id: 'lake', name: '湖沼', desc: '湖が多く広い', values: { mtnCount: null, mtnHeight: 1, lakeCount: 4, lakeSize: 1.4 } },
    { id: 'plain', name: '平原', desc: '山が低く、なだらか', values: { mtnCount: 1, mtnHeight: 0.6, lakeCount: null, lakeSize: 1 } },
  ]),
  soil: Object.freeze([
    { id: 'standard', name: '標準', desc: '4 種類の土壌が均等', values: { soil: [1, 1, 1, 1] } },
    { id: 'fertile', name: '肥沃', desc: '肥沃な土地が広い', values: { soil: [0.3, 0.5, 1, 0.5] } },
    { id: 'barren', name: '荒れ地', desc: '岩場と砂地が多い', values: { soil: [1, 1, 0.3, 0.2] } },
    { id: 'wetland', name: '湿地', desc: '泥炭が多い', values: { soil: [0.3, 0.3, 0.6, 1] } },
  ]),
  climate: Object.freeze([
    { id: 'standard', name: '標準', desc: '今までどおりの気候', values: { tempOffset: 0, seasonAmp: 1, wetness: 0 } },
    { id: 'warm', name: '温暖', desc: '平均気温が高い', values: { tempOffset: 4, seasonAmp: 0.8, wetness: 0 } },
    { id: 'cold', name: '寒冷', desc: '平均気温が低い', values: { tempOffset: -4, seasonAmp: 1.1, wetness: 0 } },
    { id: 'dry', name: '乾燥', desc: '干ばつが多い', values: { tempOffset: 1, seasonAmp: 1, wetness: -0.6 } },
    { id: 'wet', name: '多雨', desc: '雨が多い', values: { tempOffset: 0, seasonAmp: 1, wetness: 0.6 } },
  ]),
});
