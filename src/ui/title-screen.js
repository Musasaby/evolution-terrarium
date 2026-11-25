// ===== タイトル画面と世界の設定画面 =====
// 画面の入力を world-form.js（DOM 非依存）の関数で設定に変え、「はじめる」で actions.start に渡す。
import { SETTING_PRESETS } from '../sim/index.js';
import { CATEGORIES, CUSTOM_LABEL, editDetail, formToSettings, randomSeed, selectPreset } from './world-form.js';

const SOIL_NAMES = ['岩場', '砂地', '肥沃', '泥炭'];
const range = (key, label, min, max, step, fmt) => ({ key, label, kind: 'range', min, max, step, fmt });
const countSelect = (key, label, max) => ({ key, label, kind: 'count', max });
const DETAIL_FIELDS = [
  range('size', '広さ（m）', 80, 160, 5, v => v.toFixed(0)),
  countSelect('mtnCount', '山の数', 5),
  range('mtnHeight', '山の高さ', 0.4, 1.8, 0.05, v => `×${v.toFixed(2)}`),
  countSelect('lakeCount', '湖の数', 4),
  range('lakeSize', '湖の広さ', 0.4, 2, 0.05, v => `×${v.toFixed(2)}`),
  ...SOIL_NAMES.map((n, i) => ({ ...range(`soil${i}`, `土壌：${n}`, 0, 1, 0.05, v => v.toFixed(2)), soil: i })),
  range('tempOffset', '気温のずれ（℃）', -8, 8, 0.5, v => (v > 0 ? '+' : '') + v.toFixed(1)),
  range('seasonAmp', '季節の振れ幅', 0.5, 1.5, 0.05, v => `×${v.toFixed(2)}`),
  range('wetness', '降水（少 ↔ 多）', -1, 1, 0.05, v => (v > 0 ? '+' : '') + v.toFixed(2)),
];

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

// root: #title 要素。actions: { start(seed, settings), cancel() }
export function createTitleScreen(root, actions) {
  let form = null;
  const presetButtons = new Map();  // `${category}/${id}` → button
  const pickLabels = new Map();     // category → 表示中の選択名
  const fieldViews = new Map();     // field.key → { input, out }
  const seedInput = el('input', { type: 'number', min: 0, max: 999999999, step: 1, id: 'title-seed' });
  const details = el('details', { className: 'title-details' });
  const startBtn = el('button', { className: 'lone primary', textContent: 'はじめる' });
  const cancelBtn = el('button', { className: 'lone', textContent: 'キャンセル', title: '今の世界に戻る' });

  const apply = (next) => { form = next; sync(); };

  // ----- テンプレート -----
  const cats = el('div', { className: 'title-cats' });
  for (const { id: cat, label } of CATEGORIES) {
    const group = el('div', { className: 'title-cat' });
    const picked = el('span', { className: 'picked' });
    pickLabels.set(cat, picked);
    const row = el('div', { className: 'seg', role: 'group', ariaLabel: label });
    for (const p of SETTING_PRESETS[cat]) {
      const b = el('button', { textContent: p.name, title: p.desc });
      b.addEventListener('click', () => apply(selectPreset(form, cat, p.id)));
      presetButtons.set(`${cat}/${p.id}`, b);
      row.append(b);
    }
    group.append(el('h2', {}, label, picked), row, el('div', { className: 'note', id: `desc-${cat}` }));
    cats.append(group);
  }

  // ----- 詳細設定 -----
  const grid = el('div', { className: 'title-grid' });
  for (const f of DETAIL_FIELDS) {
    const out = el('output', { className: 'val' });
    let input;
    if (f.kind === 'count') {
      input = el('select', {}, el('option', { value: '', textContent: 'おまかせ' }),
        ...Array.from({ length: f.max + 1 }, (_, n) => el('option', { value: String(n), textContent: String(n) })));
      input.addEventListener('change', () => apply(editDetail(form, { [f.key]: input.value === '' ? null : +input.value })));
    } else {
      input = el('input', { type: 'range', min: f.min, max: f.max, step: f.step });
      input.addEventListener('input', () => {
        const v = +input.value;
        if (f.soil === undefined) return apply(editDetail(form, { [f.key]: v }));
        const soil = [...form.detail.soil]; soil[f.soil] = v;
        apply(editDetail(form, { soil }));
      });
    }
    fieldViews.set(f.key, { f, input, out });
    grid.append(el('label', {}, el('span', { textContent: f.label }), input, out));
  }
  details.append(el('summary', { textContent: '詳細設定' }), grid);

  // ----- シード -----
  seedInput.addEventListener('input', () => {
    const v = Math.floor(+seedInput.value);
    if (seedInput.value !== '' && Number.isFinite(v) && v >= 0) form = { ...form, seed: v };
  });
  const dice = el('button', { className: 'lone', textContent: '乱数で決め直す', title: 'シード値を乱数で決め直す' });
  dice.addEventListener('click', () => apply({ ...form, seed: randomSeed() }));

  startBtn.addEventListener('click', () => actions.start(form.seed, formToSettings(form)));
  cancelBtn.addEventListener('click', () => actions.cancel());

  root.replaceChildren(el('div', { className: 'title-card' },
    el('h1', { textContent: '円柱生物の進化箱庭' }),
    el('p', { className: 'note', textContent: '世界のつくりを選んで「はじめる」。同じシードと設定なら、同じ世界になります。' }),
    cats,
    details,
    el('div', { className: 'title-seed' }, el('label', { htmlFor: 'title-seed', textContent: 'シード' }), seedInput, dice),
    el('div', { className: 'title-actions' }, cancelBtn, startBtn)));

  // 状態 → 画面
  function sync() {
    for (const { id: cat } of CATEGORIES) {
      const pick = form.picks[cat];
      for (const p of SETTING_PRESETS[cat]) presetButtons.get(`${cat}/${p.id}`).setAttribute('aria-pressed', String(p.id === pick));
      const preset = SETTING_PRESETS[cat].find(p => p.id === pick);
      pickLabels.get(cat).textContent = preset ? '' : `（${CUSTOM_LABEL}）`;
      root.querySelector(`#desc-${cat}`).textContent = preset ? preset.desc : '詳細設定で個別に変えています';
    }
    for (const { f, input, out } of fieldViews.values()) {
      const v = f.soil === undefined ? form.detail[f.key] : form.detail.soil[f.soil];
      if (f.kind === 'count') { input.value = v === null ? '' : String(v); out.textContent = ''; }
      else { input.value = String(v); out.textContent = f.fmt(v); }
    }
    if (document.activeElement !== seedInput) seedInput.value = String(form.seed);
  }

  return {
    // nextForm: world-form.js の form。canCancel: 今の世界に戻れるか
    show(nextForm, { canCancel }) {
      form = nextForm;
      cancelBtn.hidden = !canCancel;
      seedInput.value = String(form.seed);
      sync();
      root.hidden = false;
      startBtn.focus();
    },
    hide() { root.hidden = true; },
    isOpen: () => !root.hidden,
  };
}
