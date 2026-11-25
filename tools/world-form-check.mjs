// 世界の設定フォームの変換（DOM 非依存）の往復確認: node tools/world-form-check.mjs
import { SETTING_PRESETS, normalizeSettings, DEFAULT_SETTINGS } from '../src/sim/index.js';
import { CATEGORIES, editDetail, formFromSettings, formToSettings, parseWorld, selectPreset, serializeWorld, settingsLabel } from '../src/ui/world-form.js';

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'NG  '}${msg}`); if (!cond) fail++; };
const J = JSON.stringify;

// 1. 既定のフォーム: 全カテゴリが「標準」、設定は既定値と等しい
let form = formFromSettings(undefined, 1);
ok(CATEGORIES.every(c => form.picks[c.id] === 'standard'), `既定の選択 ${J(form.picks)}`);
ok(J(formToSettings(form)) === J(normalizeSettings(DEFAULT_SETTINGS)), '既定の詳細値 → 設定 は DEFAULT_SETTINGS と一致');

// 2. 全テンプレート: 選ぶ → 詳細値がテンプレートに揃い、選択がそのテンプレートになる → 設定 → normalizeSettings が不変
for (const { id: cat } of CATEGORIES) {
  for (const p of SETTING_PRESETS[cat]) {
    const f = selectPreset(formFromSettings(undefined, 1), cat, p.id);
    const s = formToSettings(f);
    const want = normalizeSettings({ ...DEFAULT_SETTINGS, ...p.values });
    const valuesOk = Object.keys(p.values).every(k => J(s[k]) === J(want[k]));
    ok(f.picks[cat] === p.id && valuesOk && J(normalizeSettings(s)) === J(s), `${cat}/${p.id} → ${J(f.picks)} 詳細=${J(Object.fromEntries(Object.keys(p.values).map(k => [k, s[k]])))}`);
  }
}

// 3. 詳細設定を手で変える → そのカテゴリだけ「カスタム」、他は変わらない
form = selectPreset(selectPreset(formFromSettings(undefined, 1), 'terrain', 'mountain'), 'climate', 'warm');
let edited = editDetail(form, { mtnHeight: 0.9 });
ok(edited.picks.terrain === 'custom' && edited.picks.climate === 'warm' && edited.picks.size === 'standard', `山の高さを手で変更 → ${J(edited.picks)}`);
edited = editDetail(edited, { mtnHeight: 1.3 });
ok(edited.picks.terrain === 'mountain', `値を戻すと山岳に戻る → ${J(edited.picks)}`);
edited = editDetail(form, { soil: [1, 0.2, 1, 1] });
ok(edited.picks.soil === 'custom', `土壌を手で変更 → ${J(edited.picks)}`);
ok(editDetail(form, { size: 9999 }).detail.size === 160, '範囲外はクランプされる(size 9999 → 160)');

// 4. 設定 → フォーム → 設定 の往復
const s0 = normalizeSettings({ size: 150, mtnCount: 4, mtnHeight: 1.3, lakeSize: 0.7, soil: [0.3, 0.5, 1, 0.5], tempOffset: -4, wetness: 0.6 });
const s1 = formToSettings(formFromSettings(s0, 7));
ok(J(s0) === J(s1), `往復で一致 ${J(s1)}`);
ok(formFromSettings(s0, 7).detail !== s0 && Object.isFrozen(s0), '元の設定オブジェクトは書き換えない');

// 5. 設定名
ok(settingsLabel(DEFAULT_SETTINGS) === '標準', `既定の設定名 ${settingsLabel(DEFAULT_SETTINGS)}`);
ok(settingsLabel(formToSettings(selectPreset(selectPreset(formFromSettings(undefined, 1), 'size', 'large'), 'terrain', 'lake'))) === '広い・湖沼', '広い+湖沼の設定名');
ok(settingsLabel(s1).includes('カスタム(広さ)') === false && settingsLabel(normalizeSettings({ size: 100 })) === 'カスタム(広さ)', `カスタムの設定名 ${settingsLabel(normalizeSettings({ size: 100 }))}`);

// 6. 保存文字列の往復と壊れた入力
const saved = parseWorld(serializeWorld(123456, s0));
ok(saved && saved.seed === 123456 && J(saved.settings) === J(s0), '保存→復元で一致');
ok(parseWorld(null) === null && parseWorld('{') === null && parseWorld('{"seed":"x"}') === null, '壊れた保存値は null');

console.log(fail ? `\n失敗 ${fail} 件` : '\nすべて OK');
process.exit(fail ? 1 : 0);
