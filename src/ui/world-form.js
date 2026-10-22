// ===== 世界の設定フォームの純粋な変換（DOM に依存しない。Node からも呼べる） =====
// 画面の状態 form = { seed, detail, picks } と、sim に渡す設定オブジェクトの間を変換する。
//   detail … 詳細設定の値（normalizeSettings に渡せる形）
//   picks  … カテゴリごとに選ばれているテンプレートの id（どれにも当てはまらなければ 'custom'）
import { DEFAULT_SETTINGS, normalizeSettings, SETTING_PRESETS } from '../sim/index.js';

export const CATEGORIES = Object.freeze([
  { id: 'size', label: '広さ' },
  { id: 'terrain', label: '地形' },
  { id: 'soil', label: '土壌' },
  { id: 'climate', label: '気候' },
]);
export const CUSTOM = 'custom';
export const CUSTOM_LABEL = 'カスタム';

const same = (a, b) => (Array.isArray(a) ? a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9) : a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9));

// 詳細値がテンプレートと一致するか（正規化した値どうしで比べる）
function matches(detail, preset) {
  const d = normalizeSettings(detail), p = normalizeSettings({ ...DEFAULT_SETTINGS, ...preset.values });
  return Object.keys(preset.values).every(k => same(d[k], p[k]));
}

// 詳細値から各カテゴリの選択を求める
export function picksFromDetail(detail) {
  const picks = {};
  for (const { id } of CATEGORIES) picks[id] = SETTING_PRESETS[id].find(p => matches(detail, p))?.id ?? CUSTOM;
  return picks;
}

const cloneDetail = (s) => ({ ...s, soil: [...s.soil] });

// 設定（正規化済みでなくてもよい）とシードから画面の状態を作る
export function formFromSettings(settings, seed) {
  const detail = cloneDetail(normalizeSettings(settings));
  return { seed, detail, picks: picksFromDetail(detail) };
}

// テンプレートを選ぶ → そのカテゴリの詳細値がテンプレートに揃う
export function selectPreset(form, category, presetId) {
  const preset = SETTING_PRESETS[category]?.find(p => p.id === presetId);
  if (!preset) return form;
  const detail = cloneDetail(normalizeSettings({ ...form.detail, ...preset.values }));
  return { ...form, detail, picks: picksFromDetail(detail) };
}

// 詳細設定を手で変える → 該当カテゴリの表示がテンプレートかカスタムに変わる
export function editDetail(form, patch) {
  const detail = cloneDetail(normalizeSettings({ ...form.detail, ...patch }));
  return { ...form, detail, picks: picksFromDetail(detail) };
}

export const formToSettings = (form) => normalizeSettings(form.detail);

// 実行中の世界の設定名。すべて標準なら「標準」、それ以外は標準でないカテゴリの名前をつなげる
export function settingsLabel(settings) {
  const picks = picksFromDetail(settings);
  const parts = [];
  for (const { id } of CATEGORIES) {
    if (picks[id] === CUSTOM) parts.push(`${CUSTOM_LABEL}(${CATEGORIES.find(c => c.id === id).label})`);
    else if (picks[id] !== 'standard') parts.push(SETTING_PRESETS[id].find(p => p.id === picks[id]).name);
  }
  return parts.length ? parts.join('・') : '標準';
}

// ---------- 保存（文字列との変換。保存先は呼び出し側が決める） ----------
export function serializeWorld(seed, settings) {
  return JSON.stringify({ seed, settings: normalizeSettings(settings) });
}

// 壊れた文字列・想定外の形なら null
export function parseWorld(text) {
  try {
    const o = JSON.parse(text);
    if (!o || typeof o !== 'object' || !Number.isFinite(o.seed)) return null;
    return { seed: Math.floor(o.seed), settings: normalizeSettings(o.settings) };
  } catch { return null; }
}

export const randomSeed = () => Math.floor(Math.random() * 1e9);
